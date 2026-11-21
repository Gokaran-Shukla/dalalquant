"""
DalalQuant market agent — watches the live NSE/BSE stream and talks about it.

Two layers:

1. Watcher (always on, no API key, runs on every tick in microseconds)
   Rule-based detectors with per-symbol cooldowns:
     orb        opening-range breakout / breakdown (first `orb_minutes` after 09:15)
     vwap       price stretched beyond ±`vwap_z` σ of session VWAP
     fast       move larger than `fast_pct` within `fast_window` seconds
     dayhl      new intraday high / low (after 09:45)
     volume     1-minute volume above `surge_mult` × median of the last 20 minutes
     spread     NSE–BSE price gap wider than `spread_bps` for a dual-listed stock (both legs subscribed)
     stale      feed silent for 30 s during market hours
   Every event goes to the DalalQuant page (WebSocket), the event log, and — if "agent.notify_alerts"
   is true — to Telegram/email/WhatsApp through notify.py.

2. Analyst (needs "anthropic_api_key")
   * ask(question): a Claude tool-use loop over the live state (quotes, 1-minute bars, VWAP/ORB state,
     events, NSE–BSE spread, subscribing new symbols). Read-only — it cannot place orders.
   * optional desk commentary every `narrate_every` seconds while events are arriving ("agent.narrate").

Signals are mechanical observations of the tape, not investment advice.
"""
from __future__ import annotations

import json
import logging
import statistics
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from typing import Any, Callable

from live_feed import FeedHub, market_open, now_ist

log = logging.getLogger("dalalquant.agent")

DEFAULTS = {
    "orb_minutes": 15, "orb_buffer_pct": 0.05,
    "vwap_z": 2.0, "vwap_min_minutes": 20,
    "fast_pct": 0.8, "fast_window": 180,
    "surge_mult": 4.0, "surge_min_bars": 10,
    "spread_bps": 25.0, "spread_max_age": 5.0,
    "dayhl_after": "09:45",
    "cooldown": 600,
    "notify_alerts": False, "narrate": False, "narrate_every": 300,
}


class SymState:
    __slots__ = ("day", "pv", "v", "pv2", "or_hi", "or_lo", "or_done", "or_fired", "hi", "lo", "path", "vols", "ltp")

    def __init__(self, day):
        self.day = day
        self.pv = self.v = self.pv2 = 0.0
        self.or_hi = self.or_lo = None
        self.or_done = False
        self.or_fired: set[str] = set()
        self.hi = self.lo = None
        self.path: deque = deque(maxlen=4000)   # (ts, ltp)
        self.vols: deque = deque(maxlen=30)     # closed 1-min bar volumes
        self.ltp = None

    def vwap(self):
        if self.v <= 0:
            return None, None
        m = self.pv / self.v
        return m, max(0.0, self.pv2 / self.v - m * m) ** 0.5


class MarketAgent:
    def __init__(self, hub: FeedHub, cfg: Callable[[str, Any], Any], notify_send: Callable[[str, str], Any] | None = None):
        self.hub, self.cfg, self.notify_send = hub, cfg, notify_send
        self.p = {**DEFAULTS, **(cfg("agent", {}) or {})}
        self.s: dict[str, SymState] = {}
        self.events: deque = deque(maxlen=1000)
        self.cool: dict[tuple, float] = {}
        self.lock = threading.RLock()
        self.owned: set[str] = set()           # symbols the agent itself subscribed (watchlist / ask tool)
        self._seq = 0
        self._since_note = 0
        hub.listeners.append(self._on_feed)
        threading.Thread(target=self._narrator, name="dq-agent-narrator", daemon=True).start()

    # ------------------------------------------------------------------ params
    def params(self) -> dict:
        return dict(self.p)

    def set_params(self, upd: dict) -> dict:
        for k, v in (upd or {}).items():
            if k not in DEFAULTS:
                continue
            d = DEFAULTS[k]
            if isinstance(d, bool):
                if isinstance(v, bool):
                    self.p[k] = v
            elif isinstance(d, (int, float)) and isinstance(v, (int, float)) and not isinstance(v, bool):
                self.p[k] = type(d)(v)
            elif isinstance(d, str) and isinstance(v, str):
                self.p[k] = v
        return self.params()

    def watch(self, keys: list[str]) -> list[str]:
        new = [k for k in keys if k not in self.owned]
        if new:
            added = self.hub.subscribe(new)
            self.owned |= set(added)
        return sorted(self.owned)

    # ------------------------------------------------------------------ feed listener (feed thread)
    def _on_feed(self, kind: str, x: Any) -> None:
        if kind == "tick":
            self._tick(x)
        elif kind == "bar":
            self._bar(x)
        elif kind == "status" and isinstance(x, dict) and x.get("stale"):
            self.emit("*", "stale", "alert", f"No ticks from the {x.get('feed')} feed for 30 s during market hours — data may be frozen.", {})

    def _st(self, k: str) -> SymState:
        day = now_ist().date()
        st = self.s.get(k)
        if st is None or st.day != day:
            st = self.s[k] = SymState(day)
        return st

    def _tick(self, t: dict) -> None:
        k, px, ts = t["k"], float(t["ltp"]), float(t.get("ts") or time.time())
        now = now_ist()
        mins = now.hour * 60 + now.minute
        p = self.p
        with self.lock:
            st = self._st(k)
            prev_hi, prev_lo = st.hi, st.lo
            st.ltp = px
            st.hi = px if st.hi is None else max(st.hi, px)
            st.lo = px if st.lo is None else min(st.lo, px)
            dv = float(t.get("dv") or 0)
            if dv > 0:
                st.pv += px * dv
                st.v += dv
                st.pv2 += px * px * dv
            st.path.append((ts, px))
            while st.path and ts - st.path[0][0] > max(p["fast_window"], 60) * 1.5:
                st.path.popleft()

            # opening range
            orb_end = 555 + int(p["orb_minutes"])
            if mins < orb_end:
                st.or_hi = px if st.or_hi is None else max(st.or_hi, px)
                st.or_lo = px if st.or_lo is None else min(st.or_lo, px)
            elif st.or_hi is not None:
                st.or_done = True
                buf = p["orb_buffer_pct"] / 100
                if px > st.or_hi * (1 + buf) and "up" not in st.or_fired:
                    st.or_fired.add("up")
                    self.emit(k, "orb", "watch", f"{k} broke above its {p['orb_minutes']}-min opening range high {st.or_hi:,.2f} (now {px:,.2f}).",
                              {"or_hi": st.or_hi, "or_lo": st.or_lo, "ltp": px, "dir": "up"}, cooldown=False)
                elif px < st.or_lo * (1 - buf) and "dn" not in st.or_fired:
                    st.or_fired.add("dn")
                    self.emit(k, "orb", "watch", f"{k} broke below its {p['orb_minutes']}-min opening range low {st.or_lo:,.2f} (now {px:,.2f}).",
                              {"or_hi": st.or_hi, "or_lo": st.or_lo, "ltp": px, "dir": "down"}, cooldown=False)

            # VWAP stretch
            vw, sd = st.vwap()
            if vw and sd and mins >= 555 + p["vwap_min_minutes"]:
                z = (px - vw) / sd
                if abs(z) >= p["vwap_z"]:
                    self.emit(k, "vwap", "watch", f"{k} is {z:+.1f}σ from VWAP {vw:,.2f} (ltp {px:,.2f}) — stretched {'above' if z > 0 else 'below'}.",
                              {"vwap": vw, "sd": sd, "z": z, "ltp": px})

            # fast move
            ref = next((x for x in st.path if ts - x[0] <= p["fast_window"]), None)
            if ref and ref[1]:
                r = (px / ref[1] - 1) * 100
                if abs(r) >= p["fast_pct"]:
                    self.emit(k, "fast", "alert", f"{k} moved {r:+.2f}% in {int(ts - ref[0])} s ({ref[1]:,.2f} → {px:,.2f}).",
                              {"ret_pct": r, "from": ref[1], "ltp": px, "secs": ts - ref[0]})

            # new day high / low
            hh, mm = map(int, str(p["dayhl_after"]).split(":"))
            if mins >= hh * 60 + mm and prev_hi is not None:
                if px > prev_hi:
                    self.emit(k, "dayhi", "info", f"{k} made a new intraday high {px:,.2f}.", {"ltp": px})
                elif px < prev_lo:
                    self.emit(k, "daylo", "info", f"{k} made a new intraday low {px:,.2f}.", {"ltp": px})

        # NSE–BSE spread (outside the per-symbol lock: touches two symbols)
        self._spread(k, t)

    def _spread(self, k: str, t: dict) -> None:
        nse_k = k[4:] if k.startswith("BSE:") else k
        bse_k = "BSE:" + nse_k
        a, b = self.hub.last.get(nse_k), self.hub.last.get(bse_k)
        if not a or not b or nse_k in self.hub.index_names:
            return
        if abs(float(a.get("rx", 0)) - float(b.get("rx", 0))) > self.p["spread_max_age"]:
            return
        bps = (b["ltp"] / a["ltp"] - 1) * 1e4
        if abs(bps) >= self.p["spread_bps"]:
            cheap, rich = ("NSE", "BSE") if bps > 0 else ("BSE", "NSE")
            self.emit(nse_k, "spread", "watch", f"{nse_k}: BSE {b['ltp']:,.2f} vs NSE {a['ltp']:,.2f} = {bps:+.0f} bps. Cheaper on {cheap}, richer on {rich} "
                      f"(check costs and depth before acting).", {"nse": a["ltp"], "bse": b["ltp"], "bps": bps})

    def _bar(self, b: dict) -> None:
        k = b["k"]
        with self.lock:
            st = self._st(k)
            hist = list(st.vols)
            st.vols.append(b["v"])
        if len(hist) >= self.p["surge_min_bars"] and b["v"] > 0:
            med = statistics.median(hist[-20:]) or 0
            if med > 0 and b["v"] >= self.p["surge_mult"] * med:
                self.emit(k, "volume", "alert", f"{k}: {int(b['v']):,} shares in the {b['t'][-5:]} minute — {b['v'] / med:.1f}× the recent median "
                          f"(close {b['c']:,.2f}, {'up' if b['c'] >= b['o'] else 'down'} bar).", {"v": b["v"], "median": med, "bar": b})

    # ------------------------------------------------------------------ events
    def emit(self, k: str, typ: str, sev: str, msg: str, data: dict, cooldown: bool = True) -> dict | None:
        now = time.time()
        key = (k, typ, data.get("dir") or (1 if (data.get("z") or data.get("ret_pct") or data.get("bps") or 0) >= 0 else -1))
        if cooldown and now - self.cool.get(key, 0) < self.p["cooldown"]:
            return None
        self.cool[key] = now
        self._seq += 1
        last = self.hub.last.get(k, {})
        ev = {"id": self._seq, "ts": now, "t": now_ist().strftime("%H:%M:%S"), "k": k, "type": typ, "sev": sev, "msg": msg,
              "data": {a: (round(v, 4) if isinstance(v, float) else v) for a, v in data.items() if a != "bar"},
              "src": last.get("src"), "sim": bool(last.get("sim")), "delayed": bool(last.get("delayed") or last.get("poll"))}
        self.events.append(ev)
        self._since_note += 1
        self.hub.publish("event", ev)
        if sev == "alert" and self.p["notify_alerts"] and self.notify_send and not ev["sim"]:
            threading.Thread(target=self._notify, args=(ev,), daemon=True).start()
        return ev

    def _notify(self, ev):
        try:
            self.notify_send(f"DalalQuant · {ev['k']} · {ev['type']}", ev["msg"])
        except Exception as e:
            log.warning("notify failed: %s", e)

    def recent(self, k: str | None = None, limit: int = 50, since: int = 0) -> list[dict]:
        out = [e for e in self.events if e["id"] > since and (not k or e["k"] == k)]
        return out[-limit:]

    # ------------------------------------------------------------------ state for UI / tools
    def state(self, k: str) -> dict:
        st = self.s.get(k)
        if not st:
            return {}
        vw, sd = st.vwap()
        z = (st.ltp - vw) / sd if vw and sd and st.ltp else None
        return {"vwap": vw, "vwap_sd": sd, "vwap_z": z, "or_hi": st.or_hi, "or_lo": st.or_lo, "or_done": st.or_done,
                "day_hi": st.hi, "day_lo": st.lo, "session_volume": st.v}

    def quotes(self, keys: list[str] | None = None) -> dict:
        snap = self.hub.snapshot(keys)
        out = {}
        for k, t in snap.items():
            a = self.state(k)
            out[k] = {"ltp": t.get("ltp"), "chg_pct": round(t["chg"] * 100, 2) if t.get("chg") is not None else None,
                      "open": t.get("o"), "high": t.get("h"), "low": t.get("l"), "prev_close": t.get("pc"), "volume": t.get("v"),
                      "bid": t.get("bid"), "ask": t.get("ask"), "oi": t.get("oi"), "age_s": round(time.time() - t.get("rx", time.time()), 1),
                      "feed": t.get("src"), "simulated": bool(t.get("sim")), "delayed": bool(t.get("delayed") or t.get("poll")),
                      **{k2: (round(v, 3) if isinstance(v, float) else v) for k2, v in a.items()}}
        return out

    # ------------------------------------------------------------------ Claude tool-use analyst
    TOOLS = [
        {"name": "get_quotes", "description": "Latest live quotes plus session VWAP, VWAP z-score, opening range and day high/low. "
                                              "Symbols: 'RELIANCE' = NSE, 'BSE:RELIANCE' = BSE, or index names like 'NIFTY 50', 'SENSEX'. "
                                              "Omit symbols for everything currently streamed.",
         "input_schema": {"type": "object", "properties": {"symbols": {"type": "array", "items": {"type": "string"}}}}},
        {"name": "get_bars", "description": "Recent 1-minute OHLCV bars built from live ticks (the last bar may still be forming).",
         "input_schema": {"type": "object", "properties": {"symbol": {"type": "string"}, "n": {"type": "integer", "minimum": 1, "maximum": 375}},
                          "required": ["symbol"]}},
        {"name": "get_events", "description": "Recent watcher events (ORB breaks, VWAP stretches, fast moves, volume surges, NSE–BSE spreads, feed stalls).",
         "input_schema": {"type": "object", "properties": {"symbol": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 200}}}},
        {"name": "nse_bse_spread", "description": "Compare the live NSE and BSE prices of one company (subscribes both legs if needed).",
         "input_schema": {"type": "object", "properties": {"symbol": {"type": "string"}}, "required": ["symbol"]}},
        {"name": "watch", "description": "Start streaming more symbols so their data becomes available. Data arrives within a few seconds.",
         "input_schema": {"type": "object", "properties": {"symbols": {"type": "array", "items": {"type": "string"}}}, "required": ["symbols"]}},
        {"name": "feed_status", "description": "Feed name, connection state, ticks/sec, market open flag, IST time, subscribed symbols.",
         "input_schema": {"type": "object", "properties": {}}},
    ]

    SYSTEM = ("You are DalalQuant's intraday market agent for NSE and BSE. You see a live tick stream through tools. "
              "Always call tools for any number you state; never invent prices. If a symbol has no data yet, call `watch`, then `get_quotes` again. "
              "Say which feed the data comes from, and say clearly when it is simulated or delayed. Use ₹ and Indian number formatting. "
              "Be concise: lead with the answer, then the evidence (levels, VWAP/ORB context, events), then risks. "
              "You cannot place orders. End with one short line noting this is analysis of the tape, not investment advice.")

    def _run_tool(self, name: str, a: dict) -> Any:
        if name == "get_quotes":
            return self.quotes(a.get("symbols"))
        if name == "get_bars":
            return [{x: b[x] for x in ("t", "o", "h", "l", "c", "v") if x in b} for b in self.hub.get_bars(a["symbol"], int(a.get("n", 30)))]
        if name == "get_events":
            return [{x: e[x] for x in ("t", "k", "type", "sev", "msg")} for e in self.recent(a.get("symbol"), int(a.get("limit", 30)))]
        if name == "nse_bse_spread":
            sym = a["symbol"].split(":")[-1].upper()
            self.watch([sym, "BSE:" + sym])
            q = self.hub.snapshot([sym, "BSE:" + sym])
            n, b = q.get(sym), q.get("BSE:" + sym)
            if not (n and b):
                return {"status": "subscribed; waiting for both legs — ask again in a few seconds", "have": list(q)}
            return {"nse": n["ltp"], "bse": b["ltp"], "spread_bps": round((b["ltp"] / n["ltp"] - 1) * 1e4, 1),
                    "nse_age_s": round(time.time() - n["rx"], 1), "bse_age_s": round(time.time() - b["rx"], 1), "simulated": bool(n.get("sim"))}
        if name == "watch":
            return {"streaming": self.watch(a.get("symbols", [])[:50])}
        if name == "feed_status":
            return self.hub.status_dict()
        return {"error": f"unknown tool {name}"}

    def _claude(self, body: dict, timeout: int = 120) -> dict:
        key = self.cfg("anthropic_api_key")
        if not key:
            raise RuntimeError("Set anthropic_api_key in bridge/config.json (or ANTHROPIC_API_KEY) to use the AI agent.")
        req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(body).encode(), method="POST",
                                     headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"Anthropic API {e.code}: {e.read().decode()[:300]}")

    def ask(self, question: str, history: list[dict] | None = None, max_turns: int = 8) -> dict:
        model = self.cfg("anthropic_model", "claude-sonnet-5-5")
        msgs = list(history or [])[-10:] + [{"role": "user", "content": question}]
        trace = []
        for _ in range(max_turns):
            resp = self._claude({"model": model, "max_tokens": 1500, "system": self.SYSTEM, "tools": self.TOOLS, "messages": msgs})
            content = resp.get("content", [])
            msgs.append({"role": "assistant", "content": content})
            calls = [c for c in content if c.get("type") == "tool_use"]
            if resp.get("stop_reason") != "tool_use" or not calls:
                text = "".join(c.get("text", "") for c in content if c.get("type") == "text")
                return {"answer": text, "model": resp.get("model", model), "tools": trace}
            results = []
            for c in calls:
                try:
                    out = self._run_tool(c["name"], c.get("input") or {})
                    if c["name"] == "watch":
                        time.sleep(2.5)  # let first ticks arrive
                except Exception as e:
                    out = {"error": str(e)}
                trace.append({"tool": c["name"], "input": c.get("input")})
                results.append({"type": "tool_result", "tool_use_id": c["id"], "content": json.dumps(out, default=str)[:20000]})
            msgs.append({"role": "user", "content": results})
        return {"answer": "Stopped after too many tool calls — try a narrower question.", "model": model, "tools": trace}

    # ------------------------------------------------------------------ optional commentary
    def _narrator(self):
        while True:
            time.sleep(15)
            p = self.p
            if not (p["narrate"] and self.cfg("anthropic_api_key") and market_open()):
                continue
            if self._since_note < 3 or time.time() - getattr(self, "_last_note", 0) < p["narrate_every"]:
                continue
            try:
                evs = self.recent(limit=40)
                ctx = {"events": [{x: e[x] for x in ("t", "k", "type", "msg")} for e in evs], "quotes": self.quotes()}
                r = self._claude({"model": self.cfg("anthropic_model", "claude-sonnet-5-5"), "max_tokens": 400,
                                  "system": "You are a terse Indian equities desk commentator. In at most 5 bullets, say what the tape is doing "
                                            "across these NSE/BSE symbols based ONLY on the events and quotes given. Flag simulated data. No advice.",
                                  "messages": [{"role": "user", "content": json.dumps(ctx, default=str)[:30000]}]}, timeout=60)
                text = "".join(c.get("text", "") for c in r.get("content", []) if c.get("type") == "text")
                self._since_note, self._last_note = 0, time.time()
                self.hub.publish("note", {"ts": time.time(), "t": now_ist().strftime("%H:%M"), "text": text})
            except Exception as e:
                log.warning("narrator: %s", e)
                self._last_note = time.time()

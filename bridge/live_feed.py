"""
DalalQuant live feed hub — push-based real-time NSE + BSE ticks for the bridge.

The older /ws/ticks endpoint polls REST quotes every few seconds. This module instead holds ONE
streaming connection to your broker's market-data WebSocket and fans the ticks out to every
DalalQuant page and to the market agent (agent.py).

Why a broker feed and not "directly to NSE/BSE"?
    The exchanges' own real-time feeds (NSE NNF/TBT multicast, BSE EOBI/IML) are only available
    to members and licensed data vendors, inside co-location or over leased lines. Retail access to
    the same exchange data is through a broker API (or a licensed vendor such as TrueData or Global
    Datafeeds). Every adapter below carries exchange-licensed NSE and BSE data under your own
    broker account and its terms.

Feeds ("live.feed" in config.json, default = "broker"):
    fyers    – Fyers API v3 data WebSocket (SymbolUpdate)            pip install fyers-apiv3
    zerodha  – Kite Connect KiteTicker (full mode, with depth/OI)    pip install kiteconnect
    angel    – Angel One SmartAPI WebSocket V2 (snap-quote mode)     pip install smartapi-python pyotp
    sim      – simulated random-walk ticks (testing, after hours, CI) — ticks are flagged "sim"
    any other provider (yahoo, dhan, groww, nse) – REST polling fallback; ticks flagged "poll"

Symbol keys used everywhere in DalalQuant:
    "RELIANCE"        NSE cash market (default exchange)
    "BSE:RELIANCE"    BSE cash market
    "NIFTY 50", "NIFTY BANK", "SENSEX", "INDIA VIX" …  indices (names from bridge.INDEX_ALIASES)

Tick dict (fields may be missing if the feed does not send them):
    k key · x exchange · ltp · o h l pc (prev close) · v (cumulative day volume) · dv (volume since last tick)
    bid ask bq aq · oi · ts (exchange time, epoch s) · rx (receive time, epoch s) · src (feed name) · sim/poll flags

The broker adapters follow each SDK's published interface but could not be tested against live
accounts by the author. Run with "live.feed": "sim" first, then your broker during market hours.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import logging
import math
import random
import threading
import time
import urllib.request
from collections import defaultdict, deque
from typing import Any, Callable

log = logging.getLogger("dalalquant.live")

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
BSE_INDICES = {"SENSEX", "BANKEX", "BSE 100", "BSE 500", "BSE MIDCAP", "BSE SMALLCAP"}


def now_ist() -> dt.datetime:
    return dt.datetime.now(IST)


def market_open(t: dt.datetime | None = None) -> bool:
    """NSE/BSE cash session 09:15–15:30 IST, Mon–Fri (exchange holidays are not modelled)."""
    t = (t or now_ist()).astimezone(IST)
    if t.weekday() >= 5:
        return False
    m = t.hour * 60 + t.minute
    return 555 <= m < 930


def split_key(key: str, index_names: set[str]) -> tuple[str, str]:
    """'BSE:TCS' -> ('BSE','TCS'); 'TCS' -> ('NSE','TCS'); 'SENSEX' -> ('BSE','SENSEX'); 'NIFTY 50' -> ('NSE','NIFTY 50')."""
    key = key.strip()
    if key in index_names:
        return ("BSE" if key in BSE_INDICES else "NSE"), key
    if ":" in key:
        ex, sym = key.split(":", 1)
        ex = ex.upper()
        if ex in ("NSE", "BSE"):
            return ex, sym.strip().upper()
    return "NSE", key.upper()


def canon(key: str, index_names: set[str]) -> str:
    ex, sym = split_key(key, index_names)
    if sym in index_names:
        return sym
    return sym if ex == "NSE" else f"BSE:{sym}"


def _fetch(url: str, timeout: int = 90) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 DalalQuant"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# =============================================================================== hub
class FeedHub:
    """Owns one feed adapter, reference-counts subscriptions, keeps last ticks and 1-minute bars,
    and publishes ("tick" | "bar" | "status" | "event" | "note", payload) to listeners.

    Listeners are called on the feed thread: keep them fast and never block."""

    def __init__(self, make_adapter: Callable[["FeedHub"], "FeedAdapter"], index_names: set[str], bar_history: int = 400):
        self._make_adapter = make_adapter
        self.index_names = set(index_names)
        self.lock = threading.RLock()
        self.refs: dict[str, int] = defaultdict(int)
        self.last: dict[str, dict] = {}
        self.bars: dict[str, deque] = defaultdict(lambda: deque(maxlen=bar_history))
        self._cur: dict[str, dict] = {}
        self._cumv: dict[str, float] = {}
        self.listeners: list[Callable[[str, Any], None]] = []
        self.adapter: FeedAdapter | None = None
        self._rx = deque(maxlen=5000)
        self.st = {"feed": None, "connected": False, "started": None, "ticks": 0, "last_tick": None, "last_error": None, "errors": 0}
        self._watchdog: threading.Thread | None = None

    # ---- lifecycle
    def ensure_started(self) -> None:
        with self.lock:
            if self.adapter is not None:
                return
            self.adapter = self._make_adapter(self)
            self.st.update(feed=self.adapter.name, started=time.time(), connected=False, last_error=None)
        try:
            self.adapter.start()
        except Exception as e:  # e.g. broker not logged in today
            self.status(False, f"{type(e).__name__}: {e}")
            with self.lock:
                self.adapter = None
            raise
        with self.lock:
            keys = [k for k, n in self.refs.items() if n > 0]
        if keys:
            self.adapter.subscribe(keys)
        if self._watchdog is None:
            self._watchdog = threading.Thread(target=self._watch, name="dq-live-watchdog", daemon=True)
            self._watchdog.start()

    def restart(self) -> None:
        with self.lock:
            old, self.adapter = self.adapter, None
        if old:
            try:
                old.stop()
            except Exception:
                pass
        with self.lock:
            active = any(n > 0 for n in self.refs.values())
        if active:
            self.ensure_started()

    def _watch(self):
        """Flags a stale feed during market hours so the agent and UI can say so."""
        warned = False
        while True:
            time.sleep(5)
            lt = self.st.get("last_tick")
            stale = market_open() and self.adapter is not None and any(self.refs.values()) and (lt is None or time.time() - lt > 30)
            if stale and not warned:
                self.publish("status", {**self.status_dict(), "stale": True})
            warned = stale

    # ---- subscriptions
    def subscribe(self, keys: list[str]) -> list[str]:
        keys = [canon(k, self.index_names) for k in keys if k and k.strip()]
        new = []
        with self.lock:
            for k in keys:
                self.refs[k] += 1
                if self.refs[k] == 1:
                    new.append(k)
        if self.adapter is None:
            self.ensure_started()
        elif new:
            self.adapter.subscribe(new)
        return keys

    def unsubscribe(self, keys: list[str]) -> None:
        gone = []
        with self.lock:
            for k in (canon(x, self.index_names) for x in keys):
                if self.refs.get(k, 0) > 0:
                    self.refs[k] -= 1
                    if self.refs[k] == 0:
                        gone.append(k)
        if gone and self.adapter is not None:
            try:
                self.adapter.unsubscribe(gone)
            except Exception as e:
                log.warning("unsubscribe failed: %s", e)

    def subscribed(self) -> list[str]:
        with self.lock:
            return sorted(k for k, n in self.refs.items() if n > 0)

    # ---- inbound from adapters (any thread)
    def on_tick(self, t: dict) -> None:
        k = t.get("k")
        if not k or t.get("ltp") in (None, 0):
            return
        now = time.time()
        t.setdefault("rx", now)
        t.setdefault("ts", now)
        with self.lock:
            prev = self.last.get(k, {})
            merged = {**prev, **{a: b for a, b in t.items() if b is not None}}  # feeds may send only changed fields
            v = merged.get("v")
            dv = 0.0
            if v is not None:
                pv = self._cumv.get(k)
                dv = max(0.0, float(v) - pv) if pv is not None and v >= pv else 0.0
                self._cumv[k] = float(v)
            merged["dv"] = dv
            if merged.get("pc"):
                merged["chg"] = merged["ltp"] / merged["pc"] - 1
            self.last[k] = merged
            closed = self._bar(k, merged, dv)
            self.st["ticks"] += 1
            self.st["last_tick"] = now
            self._rx.append(now)
            if not self.st["connected"]:
                self.st["connected"] = True
        self.publish("tick", merged)
        if closed:
            self.publish("bar", closed)

    def _bar(self, k: str, t: dict, dv: float) -> dict | None:
        m = int(t["ts"] // 60) * 60
        cur = self._cur.get(k)
        px = float(t["ltp"])
        if cur and cur["m"] == m:
            cur["h"] = max(cur["h"], px)
            cur["l"] = min(cur["l"], px)
            cur["c"] = px
            cur["v"] += dv
            cur["n"] += 1
            return None
        closed = None
        if cur:
            closed = {**cur, "k": k, "t": dt.datetime.fromtimestamp(cur["m"], IST).strftime("%Y-%m-%d %H:%M")}
            self.bars[k].append(closed)
        self._cur[k] = {"m": m, "o": px, "h": px, "l": px, "c": px, "v": dv, "n": 1}
        return closed

    def status(self, connected: bool, err: str | None = None) -> None:
        with self.lock:
            self.st["connected"] = connected
            if err:
                self.st["last_error"] = err
                self.st["errors"] += 1
        if err:
            log.warning("feed %s: %s", self.st.get("feed"), err)
        self.publish("status", self.status_dict())

    def publish(self, kind: str, payload: Any) -> None:
        for fn in list(self.listeners):
            try:
                fn(kind, payload)
            except Exception as e:
                log.debug("listener error: %s", e)

    # ---- reads
    def tps(self) -> float:
        cut = time.time() - 10
        return sum(1 for x in self._rx if x > cut) / 10

    def status_dict(self) -> dict:
        with self.lock:
            d = dict(self.st)
            d["subscribed"] = sorted(k for k, n in self.refs.items() if n > 0)
        d["ticks_per_sec"] = round(self.tps(), 1)
        d["market_open"] = market_open()
        d["ist"] = now_ist().strftime("%Y-%m-%d %H:%M:%S")
        return d

    def snapshot(self, keys: list[str] | None = None) -> dict:
        with self.lock:
            if not keys:
                return dict(self.last)
            ks = [canon(k, self.index_names) for k in keys]
            return {k: self.last[k] for k in ks if k in self.last}

    def get_bars(self, key: str, n: int = 60, include_open: bool = True) -> list[dict]:
        k = canon(key, self.index_names)
        with self.lock:
            out = list(self.bars.get(k, []))[-n:]
            cur = self._cur.get(k)
            if include_open and cur:
                out.append({**cur, "k": k, "t": dt.datetime.fromtimestamp(cur["m"], IST).strftime("%Y-%m-%d %H:%M"), "open": True})
        return out[-n:]


# =============================================================================== adapters
class FeedAdapter:
    name = "base"

    def __init__(self, hub: FeedHub, ctx: dict):
        self.hub, self.ctx = hub, ctx
        self.cfg: Callable[[str, Any], Any] = ctx["cfg"]
        self.aliases: dict[str, dict] = ctx.get("index_aliases", {})

    def start(self): ...
    def subscribe(self, keys: list[str]): ...
    def unsubscribe(self, keys: list[str]): ...
    def stop(self): ...

    def split(self, key: str) -> tuple[str, str]:
        return split_key(key, self.hub.index_names)


# ------------------------------------------------------------------------------- simulated
class SimFeed(FeedAdapter):
    """Random-walk ticks at ~4 Hz per symbol with occasional jumps and volume bursts, so every agent
    detector can be exercised after hours. BSE quotes track NSE with a small noisy spread."""
    name = "sim"

    def __init__(self, hub, ctx):
        super().__init__(hub, ctx)
        self.keys: set[str] = set()
        self.px: dict[str, float] = {}
        self.cum: dict[str, float] = defaultdict(float)
        self._stop = threading.Event()
        self.hz = float(self.cfg("live.sim_hz", 4))
        self.rng = random.Random(int(self.cfg("live.sim_seed", 7)))

    def start(self):
        threading.Thread(target=self._run, name="dq-sim-feed", daemon=True).start()
        self.hub.status(True)

    def subscribe(self, keys):
        self.keys |= set(keys)

    def unsubscribe(self, keys):
        self.keys -= set(keys)

    def stop(self):
        self._stop.set()

    def _base(self, sym: str) -> float:
        return 100 + (sum(map(ord, sym)) * 37) % 4900

    def _run(self):
        dt_s = 1 / self.hz
        while not self._stop.is_set():
            for k in list(self.keys):
                ex, sym = self.split(k)
                root = sym  # NSE and BSE quotes of one company share the same price path
                p = self.px.get(root) or self._base(root)
                if k == root or root not in self.keys:  # advance the path once per step (via the NSE/index key if subscribed)
                    shock = self.rng.gauss(0, 0.00025)
                    if self.rng.random() < 0.0015:
                        shock += self.rng.choice([-1, 1]) * self.rng.uniform(0.004, 0.012)  # jump
                    p = max(1.0, p * (1 + shock))
                    self.px[root] = p
                px = p * (1 + self.rng.gauss(0, 0.0004)) if k.startswith("BSE:") else p
                burst = 20 if self.rng.random() < 0.002 else 1
                if sym not in self.hub.index_names:
                    self.cum[k] += self.rng.randint(50, 800) * burst
                pc = self._base(root)
                sp = px * 0.0002
                self.hub.on_tick({"k": k, "x": ex, "ltp": round(px, 2), "pc": round(pc, 2), "v": self.cum[k] or None,
                                  "bid": round(px - sp, 2), "ask": round(px + sp, 2), "ts": time.time(), "src": "sim", "sim": True})
            self._stop.wait(dt_s)


# ------------------------------------------------------------------------------- REST polling fallback
class PollFeed(FeedAdapter):
    """Wraps a bridge Provider's REST quote() for feeds without a streaming API (yahoo, dhan, groww, nse).
    NSE symbols go through the provider; BSE symbols through yfinance '.BO' (delayed)."""

    def __init__(self, hub, ctx, provider_name: str):
        super().__init__(hub, ctx)
        self.name = provider_name
        self.keys: set[str] = set()
        self._stop = threading.Event()
        self.every = max(1.0, float(self.cfg("live.poll_seconds", 2)))

    def start(self):
        self.prov = self.ctx["make_provider"](self.name)
        threading.Thread(target=self._run, name="dq-poll-feed", daemon=True).start()
        self.hub.status(True)

    def subscribe(self, keys):
        self.keys |= set(keys)

    def unsubscribe(self, keys):
        self.keys -= set(keys)

    def stop(self):
        self._stop.set()

    def _run(self):
        while not self._stop.is_set():
            nse = [k for k in self.keys if not k.startswith("BSE:") and k != "SENSEX"]
            bse = [k for k in self.keys if k.startswith("BSE:") or k == "SENSEX"]
            try:
                if nse:
                    for s, q in (self.prov.quote(nse) or {}).items():
                        self.hub.on_tick({"k": s, "x": "NSE", "ltp": q.get("ltp"), "o": q.get("open"), "h": q.get("high"), "l": q.get("low"),
                                          "pc": q.get("prev_close"), "v": q.get("volume"), "src": self.name, "poll": True})
                if bse:
                    self._bse(bse)
            except Exception as e:
                self.hub.status(True, f"poll: {e}")
            self._stop.wait(self.every)

    def _bse(self, keys):
        try:
            import yfinance as yf
        except ImportError:
            return
        ymap = {("^BSESN" if k == "SENSEX" else k.split(":", 1)[1] + ".BO"): k for k in keys}
        data = yf.download(list(ymap), period="5d", interval="1d", group_by="ticker", progress=False, threads=True, auto_adjust=False)
        for ys, k in ymap.items():
            try:
                df = (data[ys] if len(ymap) > 1 else data).dropna(subset=["Close"])
                r, p = df.iloc[-1], df.iloc[-2] if len(df) > 1 else df.iloc[-1]
                self.hub.on_tick({"k": k, "x": "BSE", "ltp": float(r["Close"]), "o": float(r["Open"]), "h": float(r["High"]), "l": float(r["Low"]),
                                  "pc": float(p["Close"]), "v": float(r.get("Volume", 0) or 0), "src": "yahoo", "poll": True, "delayed": True})
            except Exception:
                continue


# ------------------------------------------------------------------------------- Fyers v3
class FyersFeed(FeedAdapter):
    """Fyers API v3 data socket. Needs a Fyers login today (open /login/fyers on the bridge).
    NSE equity → NSE:SYM-EQ · BSE equity → BSE:SYM-<group> from Fyers' public BSE_CM symbol master
    (falls back to -A) · indices from INDEX_ALIASES['fyers']."""
    name = "fyers"
    BSE_MASTER = "https://public.fyers.in/sym_details/BSE_CM.csv"

    def __init__(self, hub, ctx):
        super().__init__(hub, ctx)
        self.to_fy: dict[str, str] = {}
        self.from_fy: dict[str, str] = {}
        self._bse: dict[str, str] | None = None
        self.ws = None

    def _bse_map(self) -> dict[str, str]:
        if self._bse is None:
            self._bse = {}
            try:
                text = _fetch(self.cfg("fyers.bse_master", self.BSE_MASTER)).decode("utf-8", "ignore")
                for row in csv.reader(io.StringIO(text)):
                    for cell in row:  # locate the 'BSE:SYM-GRP' ticker column without relying on column order
                        if cell.startswith("BSE:") and "-" in cell:
                            sym = cell[4:].rsplit("-", 1)[0]
                            self._bse.setdefault(sym, cell)
                            break
            except Exception as e:
                log.warning("Fyers BSE symbol master unavailable (%s); using SYM-A", e)
        return self._bse

    def fy(self, key: str) -> str:
        if key in self.to_fy:
            return self.to_fy[key]
        ex, sym = self.split(key)
        if sym in self.aliases and self.aliases[sym].get("fyers"):
            s = self.aliases[sym]["fyers"]
        elif ex == "BSE":
            s = self._bse_map().get(sym, f"BSE:{sym}-A")
        else:
            s = f"NSE:{sym}-EQ"
        self.to_fy[key], self.from_fy[s] = s, key
        return s

    def start(self):
        from fyers_apiv3.FyersWebsocket import data_ws
        tok = self.ctx["token"]("fyers") or self.cfg("fyers.access_token")
        if not tok:
            raise RuntimeError("Fyers: not logged in today — open /login/fyers on the bridge, then POST /live/restart")
        cid = self.cfg("fyers.client_id")
        self.ws = data_ws.FyersDataSocket(access_token=f"{cid}:{tok}", log_path="", litemode=False, write_to_file=False,
                                          reconnect=True, on_connect=self._open, on_close=self._close, on_error=self._err, on_message=self._msg)
        threading.Thread(target=self.ws.connect, name="dq-fyers-ws", daemon=True).start()

    def _open(self):
        self.hub.status(True)
        keys = self.hub.subscribed()
        if keys:
            self.subscribe(keys)
        try:
            self.ws.keep_running()
        except Exception:
            pass

    def _close(self, msg=None):
        self.hub.status(False, f"fyers closed: {msg}")

    def _err(self, msg=None):
        self.hub.status(self.hub.st["connected"], f"fyers error: {msg}")

    def subscribe(self, keys):
        if not self.ws:
            return
        syms = [self.fy(k) for k in keys]
        for i in range(0, len(syms), 100):
            self.ws.subscribe(symbols=syms[i:i + 100], data_type="SymbolUpdate")

    def unsubscribe(self, keys):
        if self.ws:
            self.ws.unsubscribe(symbols=[self.fy(k) for k in keys], data_type="SymbolUpdate")

    def stop(self):
        try:
            self.ws and self.ws.close_connection()
        except Exception:
            pass

    def _msg(self, m):
        if not isinstance(m, dict) or m.get("type") not in ("sf", "if", "dp"):
            return
        k = self.from_fy.get(m.get("symbol", ""))
        if not k:
            return
        ex, _ = self.split(k)
        self.hub.on_tick({"k": k, "x": ex, "ltp": m.get("ltp"), "o": m.get("open_price"), "h": m.get("high_price"), "l": m.get("low_price"),
                          "pc": m.get("prev_close_price"), "v": m.get("vol_traded_today"), "bid": m.get("bid_price"), "ask": m.get("ask_price"),
                          "bq": m.get("bid_size"), "aq": m.get("ask_size"), "oi": m.get("OI") or m.get("oi"),
                          "ts": m.get("exch_feed_time") or m.get("last_traded_time"), "src": "fyers"})


# ------------------------------------------------------------------------------- Zerodha KiteTicker
class ZerodhaFeed(FeedAdapter):
    """Kite Connect ticker (full mode). Needs a Kite login today (open /login/zerodha on the bridge)."""
    name = "zerodha"

    def __init__(self, hub, ctx):
        super().__init__(hub, ctx)
        self.tok_of: dict[str, int] = {}
        self.key_of: dict[int, str] = {}
        self.instr: dict[str, dict[str, int]] = {}
        self.kt = None

    def start(self):
        from kiteconnect import KiteConnect, KiteTicker
        api_key = self.cfg("zerodha.api_key")
        tok = self.ctx["token"]("zerodha") or self.cfg("zerodha.access_token")
        if not tok:
            raise RuntimeError("Zerodha: not logged in today — open /login/zerodha on the bridge, then POST /live/restart")
        kite = KiteConnect(api_key=api_key)
        kite.set_access_token(tok)
        for ex in ("NSE", "BSE"):
            self.instr[ex] = {x["tradingsymbol"]: x["instrument_token"] for x in kite.instruments(ex)}
        self.kt = KiteTicker(api_key, tok)
        self.kt.on_ticks = lambda ws, ticks: [self._tick(t) for t in ticks]
        self.kt.on_connect = lambda ws, resp: self._open()
        self.kt.on_close = lambda ws, code, reason: self.hub.status(False, f"kite closed {code}: {reason}")
        self.kt.on_error = lambda ws, code, reason: self.hub.status(False, f"kite error {code}: {reason}")
        self.kt.on_reconnect = lambda ws, n: log.info("kite reconnect attempt %s", n)
        self.kt.connect(threaded=True)

    def _token(self, key: str) -> int | None:
        if key in self.tok_of:
            return self.tok_of[key]
        ex, sym = self.split(key)
        if sym in self.aliases and self.aliases[sym].get("zerodha"):
            ex, sym = self.aliases[sym]["zerodha"].split(":", 1)
        t = self.instr.get(ex, {}).get(sym)
        if t is not None:
            self.tok_of[key], self.key_of[t] = t, key
        else:
            log.warning("zerodha: no instrument for %s", key)
        return t

    def _open(self):
        self.hub.status(True)
        keys = self.hub.subscribed()
        if keys:
            self.subscribe(keys)

    def subscribe(self, keys):
        toks = [t for t in (self._token(k) for k in keys) if t is not None]
        if toks and self.kt and self.kt.is_connected():
            self.kt.subscribe(toks)
            self.kt.set_mode(self.kt.MODE_FULL, toks)

    def unsubscribe(self, keys):
        toks = [self.tok_of[k] for k in keys if k in self.tok_of]
        if toks and self.kt and self.kt.is_connected():
            self.kt.unsubscribe(toks)

    def stop(self):
        try:
            self.kt and self.kt.close()
        except Exception:
            pass

    def _tick(self, t: dict):
        k = self.key_of.get(t.get("instrument_token"))
        if not k:
            return
        o = t.get("ohlc") or {}
        d = t.get("depth") or {}
        b0 = (d.get("buy") or [{}])[0]
        s0 = (d.get("sell") or [{}])[0]
        ts = t.get("exchange_timestamp") or t.get("last_trade_time")
        ex, _ = self.split(k)
        self.hub.on_tick({"k": k, "x": ex, "ltp": t.get("last_price"), "o": o.get("open"), "h": o.get("high"), "l": o.get("low"),
                          "pc": o.get("close"), "v": t.get("volume_traded"), "oi": t.get("oi"),
                          "bid": b0.get("price") or None, "ask": s0.get("price") or None, "bq": b0.get("quantity"), "aq": s0.get("quantity"),
                          "ts": ts.timestamp() if hasattr(ts, "timestamp") else None, "src": "zerodha"})


# ------------------------------------------------------------------------------- Angel One SmartAPI V2
class AngelFeed(FeedAdapter):
    """SmartAPI WebSocket V2 in SNAP_QUOTE mode (3). exchangeType 1 = NSE_CM, 3 = BSE_CM.
    Prices arrive in paise and are converted to rupees."""
    name = "angel"
    MASTER = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
    IDX = {"NIFTY 50": "Nifty 50", "NIFTY BANK": "Nifty Bank", "NIFTY IT": "Nifty IT", "NIFTY FIN SERVICE": "Nifty Fin Service",
           "NIFTY NEXT 50": "Nifty Next 50", "INDIA VIX": "India VIX", "SENSEX": "SENSEX"}

    def __init__(self, hub, ctx):
        super().__init__(hub, ctx)
        self.tok_of: dict[str, tuple[int, str]] = {}
        self.key_of: dict[tuple[int, str], str] = {}
        self.sws = None
        self._stop = threading.Event()

    def start(self):
        import json as _json
        import pyotp
        from SmartApi import SmartConnect
        from SmartApi.smartWebSocketV2 import SmartWebSocketV2
        api_key, code = self.cfg("angel.api_key"), self.cfg("angel.client_code")
        obj = SmartConnect(api_key=api_key)
        s = obj.generateSession(code, self.cfg("angel.pin"), pyotp.TOTP(self.cfg("angel.totp_secret")).now())
        if not s or not s.get("data"):
            raise RuntimeError(f"Angel login failed: {s}")
        jwt, feed = s["data"]["jwtToken"], obj.getfeedToken()
        rows = _json.loads(_fetch(self.cfg("angel.scrip_master", self.MASTER)))
        self.master = {"NSE": {}, "BSE": {}, "IDX": {}}
        for r in rows:
            seg, sym, it = r.get("exch_seg"), r.get("symbol", ""), r.get("instrumenttype", "")
            if seg not in ("NSE", "BSE"):
                continue
            if it == "AMXIDX":
                self.master["IDX"][r.get("name", sym).upper()] = (1 if seg == "NSE" else 3, r["token"])
                self.master["IDX"][sym.upper()] = (1 if seg == "NSE" else 3, r["token"])
            elif seg == "NSE" and sym.endswith("-EQ"):
                self.master["NSE"][sym[:-3]] = (1, r["token"])
            elif seg == "BSE" and not it:
                self.master["BSE"].setdefault(sym.split("-")[0], (3, r["token"]))
        self.sws = SmartWebSocketV2(jwt, api_key, code, feed)
        self.sws.on_open = lambda wsapp: self._open()
        self.sws.on_data = lambda wsapp, msg: self._tick(msg)
        self.sws.on_error = lambda *a: self.hub.status(False, f"angel error: {a[-1] if a else ''}")
        self.sws.on_close = lambda *a: self.hub.status(False, "angel closed")
        threading.Thread(target=self._run, name="dq-angel-ws", daemon=True).start()

    def _run(self):
        backoff = 2
        while not self._stop.is_set():
            try:
                self.sws.connect()  # blocks until closed
            except Exception as e:
                self.hub.status(False, f"angel: {e}")
            if self._stop.wait(backoff):
                return
            backoff = min(backoff * 2, 60)

    def _token(self, key):
        if key in self.tok_of:
            return self.tok_of[key]
        ex, sym = self.split(key)
        if sym in self.hub.index_names:
            t = self.master["IDX"].get(self.IDX.get(sym, sym).upper()) or self.master["IDX"].get(sym.upper())
        else:
            t = self.master[ex].get(sym)
        if t:
            self.tok_of[key], self.key_of[t] = t, key
        else:
            log.warning("angel: no token for %s", key)
        return t

    def _list(self, keys):
        by: dict[int, list[str]] = defaultdict(list)
        for k in keys:
            t = self._token(k)
            if t:
                by[t[0]].append(t[1])
        return [{"exchangeType": e, "tokens": v} for e, v in by.items()]

    def _open(self):
        self.hub.status(True)
        keys = self.hub.subscribed()
        if keys:
            self.subscribe(keys)

    def subscribe(self, keys):
        tl = self._list(keys)
        if tl and self.sws:
            try:
                self.sws.subscribe("dq", 3, tl)
            except Exception as e:
                log.info("angel subscribe deferred until open: %s", e)

    def unsubscribe(self, keys):
        tl = self._list(keys)
        if tl and self.sws:
            self.sws.unsubscribe("dq", 3, tl)

    def stop(self):
        self._stop.set()
        try:
            self.sws and self.sws.close_connection()
        except Exception:
            pass

    def _tick(self, m):
        if not isinstance(m, dict):
            return
        k = self.key_of.get((int(m.get("exchange_type", 0)), str(m.get("token"))))
        if not k:
            return
        P = lambda x: (x / 100.0) if isinstance(x, (int, float)) and x else None
        b = (m.get("best_5_buy_data") or [{}])[0]
        s = (m.get("best_5_sell_data") or [{}])[0]
        ts = m.get("exchange_timestamp")
        ex, _ = self.split(k)
        self.hub.on_tick({"k": k, "x": ex, "ltp": P(m.get("last_traded_price")), "o": P(m.get("open_price_of_the_day")),
                          "h": P(m.get("high_price_of_the_day")), "l": P(m.get("low_price_of_the_day")), "pc": P(m.get("closed_price")),
                          "v": m.get("volume_trade_for_the_day"), "oi": m.get("open_interest"), "bid": P(b.get("price")), "ask": P(s.get("price")),
                          "bq": b.get("quantity"), "aq": s.get("quantity"), "ts": ts / 1000 if ts else None, "src": "angel"})


STREAMING = {"sim": SimFeed, "fyers": FyersFeed, "zerodha": ZerodhaFeed, "angel": AngelFeed}


def make_adapter(name: str, hub: FeedHub, ctx: dict) -> FeedAdapter:
    name = (name or "sim").lower()
    if name in STREAMING:
        return STREAMING[name](hub, ctx)
    return PollFeed(hub, ctx, name)

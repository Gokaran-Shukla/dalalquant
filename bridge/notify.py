"""
Notifications and scheduled jobs for the DalalQuant bridge.

Channels (configure in config.json → "notify"):
    telegram: {"bot_token": "...", "chat_id": "..."}     create a bot with @BotFather, send it a message, then read chat_id
                                                         from https://api.telegram.org/bot<token>/getUpdates
    email:    {"smtp_host": "smtp.gmail.com", "smtp_port": 587, "user": "...", "password": "<app password>", "to": "..."}
    whatsapp: {"callmebot_phone": "+91...", "callmebot_apikey": "..."}   (free CallMeBot relay; optional)

Server-side alerts keep running while the web page is closed: the page syncs its alert rules to the bridge
(POST /alerts), and a background thread checks them against live quotes every few minutes during market hours.
A morning brief is sent on weekdays at "brief_time" (IST) — global cues, indices, high-impact news and your watchlist.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import smtplib
import threading
import time
import urllib.parse
import urllib.request
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger("dalalquant.notify")
HERE = Path(__file__).resolve().parent
RULES_FILE = HERE / ".alerts.json"
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))


def send(cfg: Callable[[str, Any], Any], title: str, text: str, channels: list[str] | None = None) -> dict:
    n = cfg("notify", {}) or {}
    ok = {"telegram": "bot_token", "email": "user", "whatsapp": "callmebot_apikey"}
    channels = channels or [c for c in ok if (n.get(c) or {}).get(ok[c])]
    res = {}
    for ch in channels:
        try:
            if ch == "telegram" and n.get("telegram"):
                t = n["telegram"]
                body = urllib.parse.urlencode({"chat_id": t["chat_id"], "text": f"{title}\n\n{text}"[:4000], "disable_web_page_preview": "true"}).encode()
                urllib.request.urlopen(f"https://api.telegram.org/bot{t['bot_token']}/sendMessage", data=body, timeout=15).read()
                res[ch] = "sent"
            elif ch == "email" and n.get("email"):
                e = n["email"]
                msg = MIMEText(text, "plain", "utf-8")
                msg["Subject"], msg["From"], msg["To"] = title, e["user"], e.get("to", e["user"])
                with smtplib.SMTP(e.get("smtp_host", "smtp.gmail.com"), int(e.get("smtp_port", 587)), timeout=20) as s:
                    s.starttls()
                    s.login(e["user"], e["password"])
                    s.send_message(msg)
                res[ch] = "sent"
            elif ch == "whatsapp" and n.get("whatsapp"):
                w = n["whatsapp"]
                q = urllib.parse.urlencode({"phone": w["callmebot_phone"], "text": f"{title}\n{text}"[:900], "apikey": w["callmebot_apikey"]})
                urllib.request.urlopen("https://api.callmebot.com/whatsapp.php?" + q, timeout=15).read()
                res[ch] = "sent"
            else:
                res[ch] = "not configured"
        except Exception as ex:
            log.warning("notify %s failed: %s", ch, ex)
            res[ch] = f"error: {ex}"
    return res


def load_rules() -> list[dict]:
    try:
        return json.loads(RULES_FILE.read_text())
    except Exception:
        return []


def save_rules(rules: list[dict]):
    RULES_FILE.write_text(json.dumps(rules))


def check_rule(r: dict, q: dict, sma200: float | None) -> bool:
    ltp, pc = q.get("ltp"), q.get("prev_close")
    if ltp is None:
        return False
    k, v = r.get("type"), float(r.get("value") or 0)
    if k == "price_above":
        return ltp >= v
    if k == "price_below":
        return ltp <= v
    if k == "pct_up":
        return bool(pc) and (ltp / pc - 1) * 100 >= v
    if k == "pct_down":
        return bool(pc) and (ltp / pc - 1) * 100 <= -abs(v)
    if k == "above_sma200":
        return sma200 is not None and ltp > sma200 and (pc or ltp) <= sma200
    if k == "below_sma200":
        return sma200 is not None and ltp < sma200 and (pc or ltp) >= sma200
    return False


def market_open(now: dt.datetime | None = None) -> bool:
    now = now or dt.datetime.now(IST)
    return now.weekday() < 5 and dt.time(9, 15) <= now.time() <= dt.time(15, 30)


class Scheduler(threading.Thread):
    """Checks server-side alert rules every `every` seconds in market hours and sends the morning brief."""

    def __init__(self, cfg, get_provider, build_brief, every: int = 180):
        super().__init__(daemon=True)
        self.cfg, self.get_provider, self.build_brief, self.every = cfg, get_provider, build_brief, every
        self.sent_brief: str | None = None
        self.fired: dict[str, str] = {}
        self._sma: dict[str, tuple[str, float]] = {}

    def sma200(self, p, sym):
        today = dt.date.today().isoformat()
        if sym in self._sma and self._sma[sym][0] == today:
            return self._sma[sym][1]
        try:
            bars = p.history(sym, 220)
            v = sum(b["c"] for b in bars[-200:]) / 200 if len(bars) >= 200 else None
        except Exception:
            v = None
        self._sma[sym] = (today, v)
        return v

    def run(self):
        while True:
            try:
                now = dt.datetime.now(IST)
                bt = self.cfg("brief_time", "08:45")
                if bt and now.weekday() < 5 and now.strftime("%H:%M") >= bt and self.sent_brief != now.date().isoformat():
                    title, text = self.build_brief()
                    send(self.cfg, title, text)
                    self.sent_brief = now.date().isoformat()
                rules = [r for r in load_rules() if r.get("server", True) and r.get("type") in
                         ("price_above", "price_below", "pct_up", "pct_down", "above_sma200", "below_sma200")]
                if rules and market_open(now):
                    p = self.get_provider()
                    syms = sorted({r["sym"] for r in rules})
                    qs = p.quote(syms)
                    for r in rules:
                        key = f"{r.get('id')}|{now.date()}"
                        if key in self.fired:
                            continue
                        q = qs.get(r["sym"]) or {}
                        sma = self.sma200(p, r["sym"]) if "sma200" in r["type"] else None
                        if check_rule(r, q, sma):
                            self.fired[key] = now.isoformat()
                            send(self.cfg, f"DalalQuant alert · {r['sym']}", f"{r.get('label') or r['type']} — LTP {q.get('ltp')}")
            except Exception as e:
                log.warning("scheduler: %s", e)
            time.sleep(self.every)

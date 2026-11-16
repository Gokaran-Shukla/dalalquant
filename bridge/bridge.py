"""
DalalQuant bridge — connects the DalalQuant web terminal to real market data and your broker.

Run it on your own computer (or a small server you control):

    pip install -r requirements.txt
    cp config.example.json config.json      # fill in your broker keys
    python bridge.py                         # serves http://127.0.0.1:8765

Then open https://gokaran-shukla.github.io/dalalquant → Algo & Brokers → Connect.

Why a bridge?  NSE/BSE do not offer a free public real-time feed that a web page can call,
and broker API secrets must never sit inside a public web page.  The bridge keeps your keys
on your machine and exposes one small REST contract for every broker.

Providers (set "broker" in config.json, or send header X-Broker):
    nse      – official NSE end-of-day bhavcopy files (with delivery %), cached locally; POST /nse/sync first
    yahoo    – Yahoo Finance via yfinance: delayed quotes + history, no trading, no keys needed
    zerodha  – Kite Connect (pip install kiteconnect)
    fyers    – Fyers API v3 (pip install fyers-apiv3)
    dhan     – DhanHQ (pip install dhanhq)
    angel    – Angel One SmartAPI (pip install smartapi-python pyotp)
    groww    – Groww Trade API (pip install growwapi)

Fundamentals (/fundamentals), world markets (/global) and news (/news) come from yfinance and
public RSS feeds for every provider.  yfinance and RSS feeds are unofficial/free sources:
check their terms of use, and expect gaps.

IMPORTANT: the broker adapters follow each SDK's published interface but could not be tested
against live accounts by the author of this file.  Test every adapter in paper/small size first.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import math
import os
import threading
import time
import urllib.parse
import urllib.request
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel

log = logging.getLogger("dalalquant.bridge")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

HERE = Path(__file__).resolve().parent
CFG_PATH = Path(os.environ.get("DQ_CONFIG", HERE / "config.json"))
CFG: dict[str, Any] = json.loads(CFG_PATH.read_text()) if CFG_PATH.exists() else {}
TOKEN_STORE = HERE / ".tokens.json"


def cfg(path: str, default: Any = None) -> Any:
    cur: Any = CFG
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return os.environ.get("DQ_" + path.upper().replace(".", "_"), default)
        cur = cur[part]
    return cur


def load_tokens() -> dict:
    try:
        return json.loads(TOKEN_STORE.read_text())
    except Exception:
        return {}


def save_token(broker: str, value: Any) -> None:
    t = load_tokens()
    t[broker] = {"value": value, "date": dt.date.today().isoformat()}
    TOKEN_STORE.write_text(json.dumps(t))
    try:
        os.chmod(TOKEN_STORE, 0o600)
    except Exception:
        pass


def today_token(broker: str) -> Any:
    t = load_tokens().get(broker)
    return t["value"] if t and t.get("date") == dt.date.today().isoformat() else None


# --------------------------------------------------------------------------- symbols
INDEX_ALIASES = {  # DalalQuant name -> per-provider symbols
    "NIFTY 50": {"zerodha": "NSE:NIFTY 50", "fyers": "NSE:NIFTY50-INDEX", "yahoo": "^NSEI", "fo": "NIFTY"},
    "NIFTY BANK": {"zerodha": "NSE:NIFTY BANK", "fyers": "NSE:NIFTYBANK-INDEX", "yahoo": "^NSEBANK", "fo": "BANKNIFTY"},
    "SENSEX": {"zerodha": "BSE:SENSEX", "fyers": "BSE:SENSEX-INDEX", "yahoo": "^BSESN", "fo": "SENSEX"},
    "NIFTY IT": {"zerodha": "NSE:NIFTY IT", "fyers": "NSE:NIFTYIT-INDEX", "yahoo": "^CNXIT"},
    "NIFTY FIN SERVICE": {"zerodha": "NSE:NIFTY FIN SERVICE", "fyers": "NSE:FINNIFTY-INDEX", "yahoo": "NIFTY_FIN_SERVICE.NS", "fo": "FINNIFTY"},
    "NIFTY NEXT 50": {"zerodha": "NSE:NIFTY NEXT 50", "fyers": "NSE:NIFTYNXT50-INDEX", "yahoo": "^NSMIDCP", "fo": "NIFTYNXT50"},
    "INDIA VIX": {"zerodha": "NSE:INDIA VIX", "fyers": "NSE:INDIAVIX-INDEX", "yahoo": "^INDIAVIX"},
}
US_SYMBOLS = set(cfg("us_symbols", [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "BRK.B", "JPM", "LLY", "V", "UNH", "XOM", "MA",
    "COST", "WMT", "JNJ", "PG", "HD", "NFLX", "ORCL", "BAC", "ABBV", "KO", "CVX", "MRK", "AMD", "PEP", "ADBE", "CRM",
    "CSCO", "TMO", "MCD", "INTC", "QCOM", "GS", "CAT", "IBM", "PLTR"]))


def yahoo_symbol(sym: str) -> str:
    if sym in INDEX_ALIASES:
        return INDEX_ALIASES[sym]["yahoo"]
    if sym in US_SYMBOLS:
        return sym.replace(".", "-")
    return sym + ".NS"


def is_us(sym: str) -> bool:
    return sym in US_SYMBOLS


# --------------------------------------------------------------------------- maths
def _ncdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs_price(s: float, k: float, t: float, r: float, v: float, typ: str) -> float:
    if t <= 0 or v <= 0:
        return max(0.0, s - k) if typ == "CE" else max(0.0, k - s)
    d1 = (math.log(s / k) + (r + v * v / 2) * t) / (v * math.sqrt(t))
    d2 = d1 - v * math.sqrt(t)
    if typ == "CE":
        return s * _ncdf(d1) - k * math.exp(-r * t) * _ncdf(d2)
    return k * math.exp(-r * t) * _ncdf(-d2) - s * _ncdf(-d1)


def implied_vol(px: float, s: float, k: float, t: float, r: float, typ: str) -> float | None:
    if px <= 0 or t <= 0:
        return None
    lo, hi = 0.01, 3.0
    for _ in range(70):
        mid = (lo + hi) / 2
        if bs_price(s, k, t, r, mid, typ) > px:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def bs_delta(s, k, t, r, v, typ):
    if not v or t <= 0:
        return None
    d1 = (math.log(s / k) + (r + v * v / 2) * t) / (v * math.sqrt(t))
    return _ncdf(d1) if typ == "CE" else _ncdf(d1) - 1


def fy_label(d: dt.date) -> tuple[str, int, int]:
    m, y = d.month, d.year
    if m >= 4:
        q, fy = (m - 4) // 3 + 1, y + 1
    else:
        q, fy = 4, y
    return f"Q{q} FY{str(fy)[2:]}", fy, q


# --------------------------------------------------------------------------- provider base
class Provider:
    name = "base"

    def quote(self, symbols: list[str], kind: str = "equity") -> dict:
        raise HTTPException(501, f"{self.name}: quotes not implemented")

    def history(self, symbol: str, days: int) -> list[dict]:
        return YahooProvider().history(symbol, days)

    def optionchain(self, underlying: str, expiry: str | None) -> dict:
        raise HTTPException(501, f"{self.name}: option chain not implemented")

    def intraday(self, symbol: str, interval: int, days: int) -> list[dict]:
        return YahooProvider().intraday(symbol, interval, days)

    def order(self, o: "OrderIn") -> dict:
        raise HTTPException(501, f"{self.name}: order placement not supported")

    def positions(self) -> list:
        return []

    def holdings(self) -> list:
        return []

    def funds(self) -> dict:
        return {}


class YahooProvider(Provider):
    """Delayed data, no trading. Works with no keys — good for first runs."""
    name = "yahoo"

    def __init__(self):
        import yfinance  # noqa: F401

    def quote(self, symbols, kind="equity"):
        import yfinance as yf
        ymap = {yahoo_symbol(s): s for s in symbols}
        out = {}
        data = yf.download(list(ymap), period="5d", interval="1d", group_by="ticker", progress=False, threads=True, auto_adjust=False)
        for ys, s in ymap.items():
            try:
                df = data[ys] if len(ymap) > 1 else data
                df = df.dropna(subset=["Close"])
                if df.empty:
                    continue
                lastrow, prev = df.iloc[-1], df.iloc[-2] if len(df) > 1 else df.iloc[-1]
                out[s] = {"ltp": float(lastrow["Close"]), "open": float(lastrow["Open"]), "high": float(lastrow["High"]),
                          "low": float(lastrow["Low"]), "prev_close": float(prev["Close"]), "volume": float(lastrow.get("Volume", 0) or 0)}
            except Exception:
                continue
        return out

    def history(self, symbol, days):
        import yfinance as yf
        period = "5y" if days > 1100 else "3y" if days > 730 else "2y" if days > 365 else "1y"
        df = yf.Ticker(yahoo_symbol(symbol)).history(period=period, interval="1d", auto_adjust=False)
        df = df.dropna(subset=["Close"])
        return [{"t": i.strftime("%Y-%m-%d"), "o": float(r.Open), "h": float(r.High), "l": float(r.Low), "c": float(r.Close),
                 "v": float(r.Volume or 0)} for i, r in df.tail(days).iterrows()]

    def intraday(self, symbol, interval, days):
        import yfinance as yf
        iv = {1: "1m", 2: "2m", 5: "5m", 15: "15m", 30: "30m", 60: "60m"}.get(interval, "5m")
        period = f"{min(days, 7 if iv == '1m' else 59)}d"
        df = yf.Ticker(yahoo_symbol(symbol)).history(period=period, interval=iv)
        df = df.dropna(subset=["Close"])
        return [{"t": i.tz_convert("Asia/Kolkata").strftime("%Y-%m-%d %H:%M") if i.tzinfo else i.strftime("%Y-%m-%d %H:%M"), "o": float(r.Open), "h": float(r.High),
                 "l": float(r.Low), "c": float(r.Close), "v": float(r.Volume or 0)} for i, r in df.iterrows()]


class ZerodhaProvider(Provider):
    """Kite Connect. Daily login: open http://127.0.0.1:8765/login/zerodha in a browser."""
    name = "zerodha"
    _instr: dict[str, dict] = {}

    def __init__(self):
        from kiteconnect import KiteConnect
        self.kite = KiteConnect(api_key=cfg("zerodha.api_key"))
        tok = today_token("zerodha") or cfg("zerodha.access_token")
        if not tok:
            raise HTTPException(401, "Zerodha: not logged in today — open /login/zerodha on the bridge")
        self.kite.set_access_token(tok)

    def _sym(self, s, kind):
        if s in INDEX_ALIASES:
            return INDEX_ALIASES[s]["zerodha"]
        return "NSE:" + s

    def _instruments(self, exch):
        key = exch + dt.date.today().isoformat()
        if key not in ZerodhaProvider._instr:
            ZerodhaProvider._instr[key] = self.kite.instruments(exch)
        return ZerodhaProvider._instr[key]

    def quote(self, symbols, kind="equity"):
        keys = {self._sym(s, kind): s for s in symbols}
        out = {}
        items = list(keys)
        for i in range(0, len(items), 450):
            q = self.kite.quote(items[i:i + 450])
            for k, v in q.items():
                o = v.get("ohlc", {})
                out[keys[k]] = {"ltp": v.get("last_price"), "open": o.get("open"), "high": o.get("high"), "low": o.get("low"),
                                "prev_close": o.get("close"), "volume": v.get("volume", 0)}
        return out

    def history(self, symbol, days):
        if is_us(symbol):
            return YahooProvider().history(symbol, days)
        if symbol in INDEX_ALIASES:
            exch, ts = INDEX_ALIASES[symbol]["zerodha"].split(":", 1)
        else:
            exch, ts = "NSE", symbol
        tok = next((x["instrument_token"] for x in self._instruments(exch) if x["tradingsymbol"] == ts), None)
        if tok is None:
            raise HTTPException(404, f"instrument not found: {symbol}")
        to = dt.date.today()
        frm = to - dt.timedelta(days=int(days * 1.5))
        rows = self.kite.historical_data(tok, frm, to, "day")
        return [{"t": r["date"].strftime("%Y-%m-%d"), "o": r["open"], "h": r["high"], "l": r["low"], "c": r["close"], "v": r["volume"]} for r in rows][-days:]

    def intraday(self, symbol, interval, days):
        if is_us(symbol):
            return YahooProvider().intraday(symbol, interval, days)
        exch, ts = (INDEX_ALIASES[symbol]["zerodha"].split(":", 1) if symbol in INDEX_ALIASES else ("NSE", symbol))
        tok = next((x["instrument_token"] for x in self._instruments(exch) if x["tradingsymbol"] == ts), None)
        iv = {1: "minute", 3: "3minute", 5: "5minute", 15: "15minute", 30: "30minute", 60: "60minute"}.get(interval, "5minute")
        to = dt.datetime.now()
        rows = self.kite.historical_data(tok, to - dt.timedelta(days=days + 3), to, iv)
        return [{"t": r["date"].strftime("%Y-%m-%d %H:%M"), "o": r["open"], "h": r["high"], "l": r["low"], "c": r["close"], "v": r["volume"]} for r in rows]

    def optionchain(self, underlying, expiry):
        name = INDEX_ALIASES.get(underlying, {}).get("fo", underlying)
        exch = "BFO" if name == "SENSEX" else "NFO"
        opts = [x for x in self._instruments(exch) if x["name"] == name and x["instrument_type"] in ("CE", "PE")]
        if not opts:
            raise HTTPException(404, f"no options for {underlying}")
        expiries = sorted({x["expiry"] for x in opts})
        exp = dt.date.fromisoformat(expiry) if expiry else expiries[0]
        spot = self.quote([underlying])[underlying]["ltp"]
        chain = [x for x in opts if x["expiry"] == exp]
        strikes = sorted({x["strike"] for x in chain})
        step = min((b - a) for a, b in zip(strikes, strikes[1:])) if len(strikes) > 1 else 50
        atm = min(strikes, key=lambda k: abs(k - spot))
        near = [k for k in strikes if abs(k - atm) <= 15 * step]
        keys = [f"{exch}:{x['tradingsymbol']}" for x in chain if x["strike"] in near]
        q = {}
        for i in range(0, len(keys), 450):
            q.update(self.kite.quote(keys[i:i + 450]))
        t = max((exp - dt.date.today()).days, 0.5) / 365
        r = float(cfg("risk_free", 0.065))
        rows = {}
        for x in chain:
            if x["strike"] not in near:
                continue
            v = q.get(f"{exch}:{x['tradingsymbol']}", {})
            ltp = v.get("last_price") or 0
            iv = implied_vol(ltp, spot, x["strike"], t, r, x["instrument_type"])
            leg = {"ltp": ltp, "oi": v.get("oi", 0), "chgoi": (v.get("oi", 0) or 0) - (v.get("oi_day_low", 0) or 0),
                   "iv": iv * 100 if iv else None, "delta": bs_delta(spot, x["strike"], t, r, iv, x["instrument_type"]),
                   "vol": v.get("volume", 0), "symbol": x["tradingsymbol"]}
            rows.setdefault(x["strike"], {"K": x["strike"]})["ce" if x["instrument_type"] == "CE" else "pe"] = leg
        return {"spot": spot, "step": step, "atm": atm, "expiry": exp.isoformat(), "expiries": [e.isoformat() for e in expiries[:8]],
                "rows": [rows[k] for k in sorted(rows) if "ce" in rows[k] and "pe" in rows[k]]}

    def order(self, o):
        k = self.kite
        exch = "NFO" if o.exchange == "NFO" else "NSE"
        oid = k.place_order(variety=k.VARIETY_REGULAR, exchange=exch, tradingsymbol=o.symbol,
                            transaction_type=k.TRANSACTION_TYPE_BUY if o.side == "BUY" else k.TRANSACTION_TYPE_SELL,
                            quantity=int(o.qty), product={"CNC": k.PRODUCT_CNC, "MIS": k.PRODUCT_MIS, "NRML": k.PRODUCT_NRML}[o.product],
                            order_type=k.ORDER_TYPE_LIMIT if o.type == "LIMIT" else k.ORDER_TYPE_MARKET,
                            price=o.price if o.type == "LIMIT" else None, tag=(o.tag or "DQ")[:20])
        return {"status": "PLACED", "order_id": oid}

    def positions(self):
        return [{"symbol": p["tradingsymbol"], "qty": p["quantity"], "avg_price": p["average_price"], "pnl": p["pnl"]} for p in self.kite.positions()["net"]]

    def holdings(self):
        return [{"symbol": h["tradingsymbol"], "qty": h["quantity"] + h.get("t1_quantity", 0), "avg_price": h["average_price"]} for h in self.kite.holdings()]

    def funds(self):
        return self.kite.margins()


class FyersProvider(Provider):
    """Fyers API v3. Daily login: open /login/fyers on the bridge."""
    name = "fyers"

    def __init__(self):
        from fyers_apiv3 import fyersModel
        tok = today_token("fyers") or cfg("fyers.access_token")
        if not tok:
            raise HTTPException(401, "Fyers: not logged in today — open /login/fyers on the bridge")
        self.f = fyersModel.FyersModel(client_id=cfg("fyers.client_id"), token=tok, is_async=False, log_path="")

    def _sym(self, s):
        if s in INDEX_ALIASES:
            return INDEX_ALIASES[s]["fyers"]
        return f"NSE:{s}-EQ"

    def quote(self, symbols, kind="equity"):
        keys = {self._sym(s): s for s in symbols if not is_us(s)}
        out = {}
        items = list(keys)
        for i in range(0, len(items), 50):
            r = self.f.quotes(data={"symbols": ",".join(items[i:i + 50])})
            for d in r.get("d", []):
                v = d.get("v", {})
                s = keys.get(d.get("n"))
                if s:
                    out[s] = {"ltp": v.get("lp"), "open": v.get("open_price"), "high": v.get("high_price"), "low": v.get("low_price"),
                              "prev_close": v.get("prev_close_price"), "volume": v.get("volume", 0)}
        us = [s for s in symbols if is_us(s)]
        if us:
            out.update(YahooProvider().quote(us))
        return out

    def history(self, symbol, days):
        if is_us(symbol):
            return YahooProvider().history(symbol, days)
        end = dt.date.today()
        start = end - dt.timedelta(days=int(days * 1.5))
        bars, cur = [], start
        while cur < end:  # Fyers limits daily candles to ~1 year per request
            nxt = min(cur + dt.timedelta(days=360), end)
            r = self.f.history(data={"symbol": self._sym(symbol), "resolution": "D", "date_format": "1",
                                     "range_from": cur.isoformat(), "range_to": nxt.isoformat(), "cont_flag": "1"})
            for c in r.get("candles", []):
                bars.append({"t": dt.datetime.fromtimestamp(c[0]).strftime("%Y-%m-%d"), "o": c[1], "h": c[2], "l": c[3], "c": c[4], "v": c[5]})
            cur = nxt + dt.timedelta(days=1)
        seen, out = set(), []
        for b in bars:
            if b["t"] not in seen:
                seen.add(b["t"]); out.append(b)
        return out[-days:]

    def intraday(self, symbol, interval, days):
        if is_us(symbol):
            return YahooProvider().intraday(symbol, interval, days)
        to = dt.date.today()
        r = self.f.history(data={"symbol": self._sym(symbol), "resolution": str(interval), "date_format": "1",
                                 "range_from": (to - dt.timedelta(days=days + 3)).isoformat(), "range_to": to.isoformat(), "cont_flag": "1"})
        return [{"t": dt.datetime.fromtimestamp(c[0]).strftime("%Y-%m-%d %H:%M"), "o": c[1], "h": c[2], "l": c[3], "c": c[4], "v": c[5]} for c in r.get("candles", [])]

    def optionchain(self, underlying, expiry):
        r = self.f.optionchain(data={"symbol": self._sym(underlying), "strikecount": 15, "timestamp": expiry or ""})
        d = r.get("data", {})
        rows, spot = {}, None
        for x in d.get("optionsChain", []):
            if x.get("option_type") not in ("CE", "PE"):
                spot = x.get("ltp", spot)
                continue
            k = x.get("strike_price")
            rows.setdefault(k, {"K": k})["ce" if x["option_type"] == "CE" else "pe"] = {
                "ltp": x.get("ltp"), "oi": x.get("oi", 0), "chgoi": x.get("oich", 0), "iv": None, "delta": None, "vol": x.get("volume", 0), "symbol": x.get("symbol")}
        strikes = sorted(rows)
        step = min((b - a) for a, b in zip(strikes, strikes[1:])) if len(strikes) > 1 else 50
        spot = spot or self.quote([underlying])[underlying]["ltp"]
        return {"spot": spot, "step": step, "atm": min(strikes, key=lambda k: abs(k - spot)) if strikes else None,
                "expiries": [e.get("date") for e in d.get("expiryData", [])], "rows": [rows[k] for k in strikes if "ce" in rows[k] and "pe" in rows[k]]}

    def order(self, o):
        sym = o.symbol if ":" in o.symbol else (f"NSE:{o.symbol}" if o.exchange == "NFO" else self._sym(o.symbol))
        r = self.f.place_order(data={"symbol": sym, "qty": int(o.qty), "type": 1 if o.type == "LIMIT" else 2, "side": 1 if o.side == "BUY" else -1,
                                     "productType": {"CNC": "CNC", "MIS": "INTRADAY", "NRML": "MARGIN"}[o.product], "limitPrice": o.price or 0,
                                     "stopPrice": 0, "validity": "DAY", "disclosedQty": 0, "offlineOrder": False, "orderTag": (o.tag or "DQ")[:20]})
        return {"status": "PLACED" if r.get("s") == "ok" else "ERROR", "order_id": r.get("id"), "message": r.get("message")}

    def positions(self):
        return [{"symbol": p["symbol"], "qty": p["netQty"], "avg_price": p["netAvg"], "pnl": p["pl"]} for p in self.f.positions().get("netPositions", [])]

    def holdings(self):
        return [{"symbol": h["symbol"].split(":")[-1].replace("-EQ", ""), "qty": h["quantity"], "avg_price": h["costPrice"]} for h in self.f.holdings().get("holdings", [])]

    def funds(self):
        return self.f.funds()


@lru_cache(maxsize=1)
def dhan_scrips() -> dict:
    """symbol -> security_id from Dhan's public scrip master (downloaded once per run)."""
    import csv, io, urllib.request
    url = cfg("dhan.scrip_master", "https://images.dhan.co/api-data/api-scrip-master.csv")
    text = urllib.request.urlopen(url, timeout=60).read().decode()
    out = {}
    for r in csv.DictReader(io.StringIO(text)):
        if r.get("SEM_EXM_EXCH_ID") == "NSE" and r.get("SEM_SEGMENT") == "E" and r.get("SEM_SERIES") == "EQ":
            out[r["SEM_TRADING_SYMBOL"]] = r["SEM_SMST_SECURITY_ID"]
    return out


class DhanProvider(Provider):
    name = "dhan"

    def __init__(self):
        import dhanhq as mod
        cid, tok = cfg("dhan.client_id"), cfg("dhan.access_token")
        if not (cid and tok):
            raise HTTPException(401, "Dhan: set dhan.client_id and dhan.access_token in config.json")
        if hasattr(mod, "DhanContext"):  # dhanhq >= 2.1
            self.d = mod.dhanhq(mod.DhanContext(cid, tok))
        else:
            self.d = mod.dhanhq(cid, tok)

    def quote(self, symbols, kind="equity"):
        ids = dhan_scrips()
        want = {int(ids[s]): s for s in symbols if s in ids}
        out = {}
        items = list(want)
        for i in range(0, len(items), 900):
            r = self.d.ohlc_data(securities={"NSE_EQ": items[i:i + 900]})
            data = (r.get("data") or {}).get("data", {}).get("NSE_EQ", {})
            for sid, v in data.items():
                s = want.get(int(sid))
                o = v.get("ohlc", {})
                if s:
                    out[s] = {"ltp": v.get("last_price"), "open": o.get("open"), "high": o.get("high"), "low": o.get("low"), "prev_close": o.get("close"), "volume": v.get("volume", 0)}
        return out

    def history(self, symbol, days):
        sid = dhan_scrips().get(symbol)
        if not sid or is_us(symbol):
            return YahooProvider().history(symbol, days)
        to = dt.date.today()
        frm = to - dt.timedelta(days=int(days * 1.5))
        r = self.d.historical_daily_data(security_id=sid, exchange_segment="NSE_EQ", instrument_type="EQUITY", from_date=frm.isoformat(), to_date=to.isoformat())
        d = r.get("data", {})
        ts = d.get("timestamp", [])
        return [{"t": dt.datetime.fromtimestamp(t).strftime("%Y-%m-%d"), "o": d["open"][i], "h": d["high"][i], "l": d["low"][i], "c": d["close"][i], "v": d["volume"][i]} for i, t in enumerate(ts)][-days:]

    def order(self, o):
        sid = dhan_scrips().get(o.symbol)
        if not sid:
            raise HTTPException(404, "Dhan security id not found for " + o.symbol)
        r = self.d.place_order(security_id=sid, exchange_segment=self.d.NSE, transaction_type=self.d.BUY if o.side == "BUY" else self.d.SELL,
                               quantity=int(o.qty), order_type=self.d.LIMIT if o.type == "LIMIT" else self.d.MARKET,
                               product_type={"CNC": self.d.CNC, "MIS": self.d.INTRA, "NRML": self.d.MARGIN}[o.product], price=o.price or 0)
        return {"status": r.get("status", "SENT"), "order_id": (r.get("data") or {}).get("orderId"), "message": r.get("remarks")}

    def positions(self):
        return [{"symbol": p.get("tradingSymbol"), "qty": p.get("netQty"), "avg_price": p.get("buyAvg"), "pnl": p.get("realizedProfit")} for p in (self.d.get_positions().get("data") or [])]

    def holdings(self):
        return [{"symbol": h.get("tradingSymbol"), "qty": h.get("totalQty"), "avg_price": h.get("avgCostPrice")} for h in (self.d.get_holdings().get("data") or [])]

    def funds(self):
        return self.d.get_fund_limits()


@lru_cache(maxsize=1)
def angel_scrips() -> dict:
    import urllib.request
    url = cfg("angel.scrip_master", "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json")
    rows = json.loads(urllib.request.urlopen(url, timeout=90).read())
    return {r["symbol"].replace("-EQ", ""): r["token"] for r in rows if r.get("exch_seg") == "NSE" and r.get("symbol", "").endswith("-EQ")}


class AngelProvider(Provider):
    name = "angel"
    _session: Any = None

    def __init__(self):
        from SmartApi import SmartConnect
        import pyotp
        if AngelProvider._session is None or AngelProvider._session[1] != dt.date.today():
            obj = SmartConnect(api_key=cfg("angel.api_key"))
            data = obj.generateSession(cfg("angel.client_code"), cfg("angel.pin"), pyotp.TOTP(cfg("angel.totp_secret")).now())
            if not data or not data.get("status"):
                raise HTTPException(401, "Angel One login failed: " + str(data))
            AngelProvider._session = (obj, dt.date.today())
        self.a = AngelProvider._session[0]

    def quote(self, symbols, kind="equity"):
        toks = angel_scrips()
        want = {toks[s]: s for s in symbols if s in toks}
        out = {}
        items = list(want)
        for i in range(0, len(items), 50):
            r = self.a.getMarketData(mode="OHLC", exchangeTokens={"NSE": items[i:i + 50]})
            for v in (r.get("data") or {}).get("fetched", []):
                s = want.get(v.get("symbolToken"))
                if s:
                    out[s] = {"ltp": v.get("ltp"), "open": v.get("open"), "high": v.get("high"), "low": v.get("low"), "prev_close": v.get("close"), "volume": v.get("tradeVolume", 0)}
        return out

    def history(self, symbol, days):
        tok = angel_scrips().get(symbol)
        if not tok:
            return YahooProvider().history(symbol, days)
        to = dt.datetime.now()
        frm = to - dt.timedelta(days=int(days * 1.5))
        r = self.a.getCandleData({"exchange": "NSE", "symboltoken": tok, "interval": "ONE_DAY", "fromdate": frm.strftime("%Y-%m-%d 09:15"), "todate": to.strftime("%Y-%m-%d 15:30")})
        return [{"t": c[0][:10], "o": c[1], "h": c[2], "l": c[3], "c": c[4], "v": c[5]} for c in (r.get("data") or [])][-days:]

    def intraday(self, symbol, interval, days):
        tok = angel_scrips().get(symbol)
        if not tok:
            return YahooProvider().intraday(symbol, interval, days)
        iv = {1: "ONE_MINUTE", 3: "THREE_MINUTE", 5: "FIVE_MINUTE", 15: "FIFTEEN_MINUTE", 30: "THIRTY_MINUTE", 60: "ONE_HOUR"}.get(interval, "FIVE_MINUTE")
        to = dt.datetime.now()
        r = self.a.getCandleData({"exchange": "NSE", "symboltoken": tok, "interval": iv, "fromdate": (to - dt.timedelta(days=days + 3)).strftime("%Y-%m-%d 09:15"), "todate": to.strftime("%Y-%m-%d %H:%M")})
        return [{"t": c[0][:16].replace("T", " "), "o": c[1], "h": c[2], "l": c[3], "c": c[4], "v": c[5]} for c in (r.get("data") or [])]

    def order(self, o):
        tok = angel_scrips().get(o.symbol)
        oid = self.a.placeOrder({"variety": "NORMAL", "tradingsymbol": o.symbol + "-EQ", "symboltoken": tok, "transactiontype": o.side, "exchange": "NSE",
                                 "ordertype": "LIMIT" if o.type == "LIMIT" else "MARKET", "producttype": {"CNC": "DELIVERY", "MIS": "INTRADAY", "NRML": "CARRYFORWARD"}[o.product],
                                 "duration": "DAY", "price": str(o.price or 0), "quantity": str(int(o.qty))})
        return {"status": "PLACED", "order_id": oid}

    def positions(self):
        return [{"symbol": p.get("tradingsymbol"), "qty": p.get("netqty"), "avg_price": p.get("netprice"), "pnl": p.get("pnl")} for p in (self.a.position().get("data") or [])]

    def holdings(self):
        return [{"symbol": h.get("tradingsymbol", "").replace("-EQ", ""), "qty": h.get("quantity"), "avg_price": h.get("averageprice")} for h in (self.a.holding().get("data") or [])]

    def funds(self):
        return self.a.rmsLimit()


class GrowwProvider(Provider):
    name = "groww"

    def __init__(self):
        from growwapi import GrowwAPI
        tok = cfg("groww.access_token")
        if not tok:
            raise HTTPException(401, "Groww: set groww.access_token in config.json")
        self.g = GrowwAPI(tok)

    def quote(self, symbols, kind="equity"):
        out = {}
        for s in symbols:
            if is_us(s) or s in INDEX_ALIASES:
                continue
            try:
                q = self.g.get_quote(exchange=self.g.EXCHANGE_NSE, segment=self.g.SEGMENT_CASH, trading_symbol=s)
                o = q.get("ohlc", {})
                out[s] = {"ltp": q.get("last_price"), "open": o.get("open"), "high": o.get("high"), "low": o.get("low"), "prev_close": o.get("close"), "volume": q.get("volume", 0)}
            except Exception as e:  # rate limits etc.
                log.debug("groww quote %s: %s", s, e)
        return out

    def order(self, o):
        g = self.g
        r = g.place_order(trading_symbol=o.symbol, quantity=int(o.qty), validity=g.VALIDITY_DAY, exchange=g.EXCHANGE_NSE, segment=g.SEGMENT_CASH,
                          product={"CNC": g.PRODUCT_CNC, "MIS": g.PRODUCT_MIS, "NRML": g.PRODUCT_NRML}[o.product],
                          order_type=g.ORDER_TYPE_LIMIT if o.type == "LIMIT" else g.ORDER_TYPE_MARKET,
                          transaction_type=g.TRANSACTION_TYPE_BUY if o.side == "BUY" else g.TRANSACTION_TYPE_SELL, price=o.price or 0)
        return {"status": r.get("order_status", "SENT"), "order_id": r.get("groww_order_id")}

    def holdings(self):
        r = self.g.get_holdings_for_user()
        return [{"symbol": h.get("trading_symbol"), "qty": h.get("quantity"), "avg_price": h.get("average_price")} for h in r.get("holdings", [])]

    def positions(self):
        r = self.g.get_positions_for_user()
        return [{"symbol": p.get("trading_symbol"), "qty": p.get("quantity"), "avg_price": p.get("net_price")} for p in r.get("positions", [])]

    def funds(self):
        return self.g.get_available_margin_details()


class NseProvider(Provider):
    """Official NSE end-of-day files (bhavcopy with delivery %), cached locally. Run /nse/sync first."""
    name = "nse"

    def quote(self, symbols, kind="equity"):
        import nse_data
        return nse_data.quotes([s for s in symbols if not is_us(s) and s not in INDEX_ALIASES])

    def history(self, symbol, days):
        import nse_data
        if is_us(symbol) or symbol in INDEX_ALIASES:
            return YahooProvider().history(symbol, days)
        bars = nse_data.history(symbol, days)
        return bars or YahooProvider().history(symbol, days)


PROVIDERS = {"nse": NseProvider, "yahoo": YahooProvider, "zerodha": ZerodhaProvider, "fyers": FyersProvider, "dhan": DhanProvider, "angel": AngelProvider, "groww": GrowwProvider}


# --------------------------------------------------------------------------- app
app = FastAPI(title="DalalQuant bridge", version="1.0")
ALLOWED = cfg("allowed_origins", ["https://gokaran-shukla.github.io", "http://localhost:8000", "http://127.0.0.1:8000", "null"])
_cors = dict(allow_origins=ALLOWED, allow_methods=["*"], allow_headers=["*"], allow_credentials=False)
try:  # Starlette >= 0.38 handles Chrome Private Network Access itself
    import inspect
    if "allow_private_network" in inspect.signature(CORSMiddleware.__init__).parameters:
        _cors["allow_private_network"] = True
except Exception:
    pass
app.add_middleware(CORSMiddleware, **_cors)


@app.middleware("http")
async def private_network_access(request: Request, call_next):
    # Chrome's Private Network Access: lets a public https page talk to this local server.
    if request.method == "OPTIONS" and request.headers.get("access-control-request-private-network"):
        resp = await call_next(request)
        resp.headers["Access-Control-Allow-Private-Network"] = "true"
        return resp
    resp = await call_next(request)
    resp.headers["Access-Control-Allow-Private-Network"] = "true"
    return resp


def auth(authorization: str | None = Header(default=None)):
    need = cfg("bridge_token")
    if need and authorization != f"Bearer {need}":
        raise HTTPException(401, "bad bridge token")


def provider(x_broker: str | None = Header(default=None)) -> Provider:
    name = (cfg("force_broker") or x_broker or cfg("broker", "yahoo")).lower()
    if name not in PROVIDERS:
        raise HTTPException(400, f"unknown broker {name}")
    try:
        return PROVIDERS[name]()
    except HTTPException:
        raise
    except ImportError as e:
        raise HTTPException(500, f"{name}: SDK not installed ({e}). See requirements.txt")
    except Exception as e:
        raise HTTPException(500, f"{name}: {e}")


class OrderIn(BaseModel):
    symbol: str
    exchange: str = "NSE"
    side: str
    qty: float
    type: str = "MARKET"
    price: float | None = 0
    product: str = "CNC"
    tag: str | None = "DQ"


@app.get("/health")
def health(x_broker: str | None = Header(default=None)):
    return {"status": "ok", "broker": (cfg("force_broker") or x_broker or cfg("broker", "yahoo")), "time": dt.datetime.now().isoformat(), "live_orders": bool(cfg("allow_live_orders", False))}


@app.get("/quote", dependencies=[Depends(auth)])
def quote(symbols: str, kind: str = "equity", p: Provider = Depends(provider)):
    syms = [s.strip() for s in symbols.split(",") if s.strip()]
    try:
        out = p.quote(syms, kind)
    except HTTPException as e:
        if e.status_code != 501:
            raise
        out = {}
    missing = [s for s in syms if s not in out]
    if missing and cfg("yahoo_fallback", True) and p.name != "yahoo":
        try:
            out.update(YahooProvider().quote(missing))
        except Exception as e:
            log.warning("yahoo fallback failed: %s", e)
    return {"quotes": out}


@app.get("/history", dependencies=[Depends(auth)])
def history(symbol: str, interval: str = "day", days: int = 1100, p: Provider = Depends(provider)):
    return {"bars": p.history(symbol, min(days, 2000))}


@app.get("/optionchain", dependencies=[Depends(auth)])
def optionchain(underlying: str, expiry: str | None = None, p: Provider = Depends(provider)):
    return p.optionchain(underlying, expiry)


@app.post("/order", dependencies=[Depends(auth)])
def order(o: OrderIn, p: Provider = Depends(provider)):
    if not cfg("allow_live_orders", False):
        raise HTTPException(403, "Live orders are disabled. Set \"allow_live_orders\": true in config.json once you have tested in paper mode.")
    if o.qty * (o.price or 0) > float(cfg("max_order_value", 200000)) and o.type == "LIMIT":
        raise HTTPException(403, "order value above max_order_value in config.json")
    log.info("ORDER %s %s %s x%s %s", p.name, o.side, o.symbol, o.qty, o.type)
    return p.order(o)


@app.get("/positions", dependencies=[Depends(auth)])
def positions(p: Provider = Depends(provider)):
    return {"positions": p.positions()}


@app.get("/holdings", dependencies=[Depends(auth)])
def holdings(p: Provider = Depends(provider)):
    return {"holdings": p.holdings()}


@app.get("/funds", dependencies=[Depends(auth)])
def funds(p: Provider = Depends(provider)):
    return {"funds": p.funds()}


# ---- notifications, server-side alerts, morning brief -------------------------
class NotifyIn(BaseModel):
    title: str
    text: str
    channels: list[str] | None = None


@app.post("/notify", dependencies=[Depends(auth)])
def notify_ep(n: NotifyIn):
    import notify
    return {"result": notify.send(cfg, n.title, n.text, n.channels)}


@app.get("/alerts", dependencies=[Depends(auth)])
def alerts_get():
    import notify
    return {"rules": notify.load_rules()}


@app.post("/alerts", dependencies=[Depends(auth)])
async def alerts_set(request: Request):
    import notify
    body = await request.json()
    notify.save_rules(body.get("rules", []))
    return {"saved": len(body.get("rules", []))}


HI_WORDS = ("fed", "rbi", "repo", "inflation", "cpi", "crude", "opec", "war", "tariff", "sanction", "budget", "gdp", "rate cut", "rate hike", "fii")


def build_brief() -> tuple[str, str]:
    """Plain-text pre-market brief from Yahoo quotes + news headlines (no broker needed)."""
    lines = []
    try:
        y = YahooProvider()
        q = y.quote(["NIFTY 50", "NIFTY BANK", "SENSEX", "INDIA VIX"])
        for k, v in q.items():
            lines.append(f"{k}: {v['ltp']:.0f} ({(v['ltp'] / v['prev_close'] - 1) * 100:+.2f}%)")
        g = global_markets("^GSPC,^IXIC,^N225,^HSI,GC=F,BZ=F,INR=X,^TNX")["instruments"]
        names = {"^GSPC": "S&P 500", "^IXIC": "Nasdaq", "^N225": "Nikkei", "^HSI": "Hang Seng", "GC=F": "Gold", "BZ=F": "Brent", "INR=X": "USD/INR", "^TNX": "US 10Y"}
        lines.append("")
        lines.append("Global: " + " · ".join(f"{names[k]} {(v['ltp'] / v['prev_close'] - 1) * 100:+.1f}%" for k, v in g.items() if k in names))
    except Exception as e:
        lines.append(f"(market data unavailable: {e})")
    try:
        items = news()["items"]
        hot = [i for i in items if any(w in i["title"].lower() for w in HI_WORDS)][:6]
        if hot:
            lines.append("")
            lines.append("High-impact headlines:")
            lines += [f"• {i['title']} ({i['source']})" for i in hot]
    except Exception:
        pass
    try:
        import notify
        syms = sorted({r["sym"] for r in notify.load_rules()} | set(cfg("watchlist", [])))[:25]
        if syms:
            wq = YahooProvider().quote(syms)
            lines.append("")
            lines.append("Watchlist: " + " · ".join(f"{s} {(v['ltp'] / v['prev_close'] - 1) * 100:+.1f}%" for s, v in wq.items()))
    except Exception:
        pass
    lines.append("")
    lines.append("Open DalalQuant for opportunities and signals: https://gokaran-shukla.github.io/dalalquant")
    return f"DalalQuant morning brief · {dt.date.today():%a %d %b %Y}", "\n".join(lines)


@app.post("/brief/send", dependencies=[Depends(auth)])
def brief_send(text: str | None = None):
    import notify
    title, body = build_brief()
    if text:
        body = text + "\n\n" + body
    return {"result": notify.send(cfg, title, body), "preview": body}


@app.on_event("startup")
def _start_scheduler():
    if cfg("scheduler", True):
        import notify
        def prov():
            name = (cfg("force_broker") or cfg("broker", "yahoo")).lower()
            return PROVIDERS[name]()
        notify.Scheduler(cfg, prov, build_brief, every=int(cfg("alert_poll_seconds", 180))).start()


# ---- intraday candles + live tick stream -------------------------------------
@app.get("/intraday", dependencies=[Depends(auth)])
def intraday(symbol: str, interval: int = 5, days: int = 5, p: Provider = Depends(provider)):
    return {"bars": p.intraday(symbol, interval, min(days, 30))}


@app.websocket("/ws/ticks")
async def ws_ticks(ws: WebSocket):
    """Streams {sym: {ltp, volume, ...}} every `every` seconds for ?symbols=A,B (token via ?token= if bridge_token set)."""
    import asyncio
    need = cfg("bridge_token")
    if need and ws.query_params.get("token") != need:
        await ws.close(code=4401)
        return
    await ws.accept()
    syms = [s for s in (ws.query_params.get("symbols") or "").split(",") if s][:200]
    every = max(1.0, float(ws.query_params.get("every", 2)))
    name = (cfg("force_broker") or ws.query_params.get("broker") or cfg("broker", "yahoo")).lower()
    try:
        prov = PROVIDERS[name]()
        while True:
            try:
                q = await asyncio.get_event_loop().run_in_executor(None, prov.quote, syms)
                await ws.send_json({"t": dt.datetime.now().isoformat(timespec="seconds"), "quotes": q})
            except Exception as e:
                await ws.send_json({"error": str(e)})
            await asyncio.sleep(every)
    except WebSocketDisconnect:
        return
    except Exception as e:
        try:
            await ws.send_json({"error": str(e)})
            await ws.close()
        except Exception:
            pass


# ---- mutual funds (mfapi.in, AMFI data) · IPOs ---------------------------------
def _json(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 DalalQuant"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


@app.get("/mf/search", dependencies=[Depends(auth)])
def mf_search(q: str):
    return {"rows": _json("https://api.mfapi.in/mf/search?q=" + urllib.parse.quote(q))[:50]}


@app.get("/mf/nav", dependencies=[Depends(auth)])
def mf_nav(code: str):
    d = _json(f"https://api.mfapi.in/mf/{urllib.parse.quote(code)}")
    rows = []
    for x in d.get("data", []):
        try:
            rows.append({"t": dt.datetime.strptime(x["date"], "%d-%m-%Y").date().isoformat(), "nav": float(x["nav"])})
        except (KeyError, ValueError):
            continue
    rows.sort(key=lambda r: r["t"])
    return {"meta": d.get("meta", {}), "nav": rows}


@app.get("/ipo", dependencies=[Depends(auth)])
def ipo():
    import nse_data
    cur = nse_data._api("ipo-current-issue", ttl=1800) or []
    up = nse_data._api("all-upcoming-issues?category=ipo", ttl=3600) or []
    return {"current": cur if isinstance(cur, list) else cur.get("data", []), "upcoming": up if isinstance(up, list) else up.get("data", [])}


# ---- NSE public data ------------------------------------------------------------
@app.post("/nse/sync", dependencies=[Depends(auth)])
def nse_sync(days: int = 760, fo_days: int = 60):
    import nse_data
    threading.Thread(target=nse_data.sync, args=(days, fo_days), daemon=True).start()
    return {"started": True, **nse_data.STATUS}


@app.get("/nse/status", dependencies=[Depends(auth)])
def nse_status():
    import nse_data
    n = len(list((nse_data.CACHE / "eq").glob("*.json")))
    return {**nse_data.STATUS, "eq_days_cached": n, "fo_days_cached": len(list((nse_data.CACHE / "fo").glob("*.json")))}


@app.get("/nse/fiidii", dependencies=[Depends(auth)])
def nse_fiidii():
    import nse_data
    return nse_data.fii_dii()


@app.get("/nse/deals", dependencies=[Depends(auth)])
def nse_deals():
    import nse_data
    return {"deals": nse_data.deals()}


@app.get("/nse/insider", dependencies=[Depends(auth)])
def nse_insider(symbol: str | None = None, days: int = 90):
    import nse_data
    return {"rows": nse_data.insider(symbol, days)}


@app.get("/nse/pledge", dependencies=[Depends(auth)])
def nse_pledge():
    import nse_data
    return {"rows": nse_data.pledges()}


@app.get("/nse/delivery", dependencies=[Depends(auth)])
def nse_delivery(symbol: str, days: int = 120):
    import nse_data
    return {"bars": [{"t": b["t"], "d": b.get("d"), "v": b["v"], "c": b["c"]} for b in nse_data.history(symbol, days, adjust=False)]}


@app.get("/fo/buildup", dependencies=[Depends(auth)])
def fo_buildup():
    import nse_data
    return {"rows": nse_data.fo_buildup()}


@app.get("/fo/rollover", dependencies=[Depends(auth)])
def fo_rollover(symbol: str):
    import nse_data
    return nse_data.rollover(symbol) or {}


@app.get("/fo/participants", dependencies=[Depends(auth)])
def fo_participants():
    import nse_data
    return nse_data.participant_oi() or {}


@app.get("/fo/ivhistory", dependencies=[Depends(auth)])
def fo_ivhistory(symbol: str, days: int = 60):
    import nse_data
    return {"rows": nse_data.option_history(symbol, days)}


# ---- tradebook for the P&L report --------------------------------------------
@app.get("/tradebook", dependencies=[Depends(auth)])
def tradebook(frm: str | None = None, to: str | None = None, request: Request = None, p: Provider = Depends(provider)):
    """Executed trades. Most broker APIs only expose today's trades; Dhan exposes a dated history.
    For a full year import the tradebook CSV from the broker console into the P&L tab."""
    q = dict(request.query_params) if request else {}
    frm = q.get("from", frm) or (dt.date.today() - dt.timedelta(days=365)).isoformat()
    to = to or dt.date.today().isoformat()
    out, note = [], "today's trades only (broker API limit)"
    try:
        if p.name == "zerodha":
            for t in p.kite.trades():
                out.append({"symbol": t["tradingsymbol"], "date": str(t.get("fill_timestamp") or t.get("exchange_timestamp"))[:10], "side": t["transaction_type"],
                            "qty": t["quantity"], "price": t["average_price"], "segment": "INTRADAY" if t.get("product") == "MIS" else t.get("exchange", "EQ")})
        elif p.name == "fyers":
            for t in p.f.tradebook().get("tradeBook", []):
                out.append({"symbol": t["symbol"].split(":")[-1].replace("-EQ", ""), "date": str(t.get("orderDateTime", ""))[:10], "side": "BUY" if t.get("side") == 1 else "SELL",
                            "qty": t.get("tradedQty"), "price": t.get("tradePrice"), "segment": "INTRADAY" if t.get("productType") == "INTRADAY" else "EQ"})
        elif p.name == "angel":
            for t in (p.a.tradeBook().get("data") or []):
                out.append({"symbol": t.get("tradingsymbol", "").replace("-EQ", ""), "date": dt.date.today().isoformat(), "side": t.get("transactiontype"),
                            "qty": t.get("fillsize"), "price": t.get("fillprice"), "segment": "INTRADAY" if t.get("producttype") == "INTRADAY" else "EQ"})
        elif p.name == "dhan":
            note = "dated trade history"
            page = 0
            while page < 50:
                r = p.d.get_trade_history(frm, to, page)
                rows = r.get("data") or []
                if not rows:
                    break
                for t in rows:
                    out.append({"symbol": t.get("tradingSymbol") or t.get("customSymbol"), "date": str(t.get("exchangeTime") or t.get("createTime"))[:10],
                                "side": t.get("transactionType"), "qty": t.get("tradedQuantity"), "price": t.get("tradedPrice"),
                                "segment": "INTRADAY" if t.get("productType") == "INTRADAY" else "EQ"})
                page += 1
        elif p.name == "groww":
            note = "not available through the Groww API — import the P&L/tradebook CSV from the Groww app"
        else:
            note = "no tradebook for this provider"
    except Exception as e:
        raise HTTPException(500, f"tradebook: {e}")
    return {"trades": out, "note": note}


# ---- fundamentals (yfinance) ------------------------------------------------
_FCACHE: dict[str, tuple[float, dict]] = {}


@app.get("/fundamentals", dependencies=[Depends(auth)])
def fundamentals(symbol: str):
    if symbol in _FCACHE and time.time() - _FCACHE[symbol][0] < 6 * 3600:
        return _FCACHE[symbol][1]
    import yfinance as yf
    tk = yf.Ticker(yahoo_symbol(symbol))
    unit = 1e6 if is_us(symbol) else 1e7  # US$ million, or ₹ crore

    def row(df, *names):
        for n in names:
            if df is not None and not df.empty and n in df.index:
                return df.loc[n]
        return None

    inc = tk.quarterly_income_stmt
    cf = tk.quarterly_cashflow
    bs = tk.quarterly_balance_sheet
    rev, ebitda, ni = row(inc, "Total Revenue", "Operating Revenue"), row(inc, "EBITDA", "Normalized EBITDA"), row(inc, "Net Income", "Net Income Common Stockholders")
    fcf = row(cf, "Free Cash Flow")
    if rev is None or ni is None:
        raise HTTPException(404, "no fundamentals for " + symbol)
    q = []
    for col in sorted(rev.index):
        d = col.date() if hasattr(col, "date") else col
        label, fy, qn = fy_label(d)
        val = lambda s: (None if s is None or col not in s.index or s[col] != s[col] else float(s[col]) / unit)
        if val(rev) is None or val(ni) is None:
            continue
        q.append({"p": label, "fy": fy, "qn": qn, "rev": val(rev), "ebitda": val(ebitda), "np": val(ni), "fcf": val(fcf)})
    info = {}
    try:
        info = tk.info or {}
    except Exception:
        pass
    latest = lambda s: (float(s.dropna().iloc[0]) / unit if s is not None and not s.dropna().empty else None)
    out = {"q": q, "source": "yfinance",
           "shares": (info.get("sharesOutstanding") or 0) / unit or None,
           "debt": latest(row(bs, "Total Debt")), "cash": latest(row(bs, "Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments")),
           "equity": latest(row(bs, "Stockholders Equity", "Common Stock Equity")),
           "promoter": (info.get("heldPercentInsiders") or 0) * 100 or None,
           "fii": None, "dii": (info.get("heldPercentInstitutions") or 0) * 100 or None,
           "dy": (info.get("dividendYield") or 0) / (100 if (info.get("dividendYield") or 0) > 1 else 1) or None}
    _FCACHE[symbol] = (time.time(), out)
    return out


# ---- world markets (yfinance) -----------------------------------------------
GLOBAL_MAP = {"GIFTNIFTY": None, "IN10Y": None}  # not on Yahoo; supply via your broker/data vendor


@app.get("/global", dependencies=[Depends(auth)])
def global_markets(ids: str):
    import yfinance as yf
    want = [i for i in ids.split(",") if i and GLOBAL_MAP.get(i, i)]
    data = yf.download(want, period="1y", interval="1d", group_by="ticker", progress=False, threads=True, auto_adjust=False)
    out = {}
    for i in want:
        try:
            df = (data[i] if len(want) > 1 else data).dropna(subset=["Close"])
            closes = [float(x) for x in df["Close"].tolist()]
            if len(closes) > 1:
                out[i] = {"ltp": closes[-1], "prev_close": closes[-2], "closes": closes}
        except Exception:
            continue
    return {"instruments": out}


# ---- news (RSS) ---------------------------------------------------------------
DEFAULT_FEEDS = [
    ("ET Markets", "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"),
    ("Moneycontrol", "https://www.moneycontrol.com/rss/marketreports.xml"),
    ("Mint", "https://www.livemint.com/rss/markets"),
    ("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
    ("Google News · India markets", "https://news.google.com/rss/search?q=sensex+OR+nifty+OR+RBI&hl=en-IN&gl=IN&ceid=IN:en"),
    ("Google News · India policy", "https://news.google.com/rss/search?q=cabinet+approves+OR+government+scheme+OR+PLI+OR+budget+India+economy&hl=en-IN&gl=IN&ceid=IN:en"),
    ("Google News · Global macro", "https://news.google.com/rss/search?q=federal+reserve+OR+crude+oil+OR+tariffs+stocks&hl=en-US&gl=US&ceid=US:en"),
]
_NEWS: dict[str, Any] = {"t": 0, "items": []}
_NLOCK = threading.Lock()


@app.get("/news", dependencies=[Depends(auth)])
def news():
    import feedparser
    with _NLOCK:
        if time.time() - _NEWS["t"] < 90:
            return {"items": _NEWS["items"]}
        items, seen = [], set()
        for src, url in [tuple(x) for x in cfg("news_feeds", DEFAULT_FEEDS)]:
            try:
                f = feedparser.parse(url)
                for e in f.entries[:40]:
                    title = (e.get("title") or "").strip()
                    key = title.lower()[:90]
                    if not title or key in seen:
                        continue
                    seen.add(key)
                    ts = e.get("published_parsed") or e.get("updated_parsed")
                    items.append({"title": title, "link": e.get("link"), "source": src,
                                  "time": dt.datetime(*ts[:6], tzinfo=dt.timezone.utc).isoformat() if ts else None,
                                  "summary": (e.get("summary") or "")[:300]})
            except Exception as ex:
                log.warning("feed %s failed: %s", src, ex)
        items.sort(key=lambda x: x["time"] or "", reverse=True)
        _NEWS.update(t=time.time(), items=items[:300])
        return {"items": _NEWS["items"]}


# ---- company profile, events, news (yfinance + Google News RSS) ---------------
_CCACHE: dict[str, tuple[float, dict]] = {}


@app.get("/company", dependencies=[Depends(auth)])
def company(symbol: str):
    if symbol in _CCACHE and time.time() - _CCACHE[symbol][0] < 3 * 3600:
        return _CCACHE[symbol][1]
    import urllib.parse
    import feedparser
    import yfinance as yf
    tk = yf.Ticker(yahoo_symbol(symbol))
    info = {}
    try:
        info = tk.info or {}
    except Exception:
        pass
    events = []
    try:
        cal = tk.calendar or {}
        if isinstance(cal, dict):
            for k in ("Earnings Date", "Ex-Dividend Date", "Dividend Date"):
                v = cal.get(k)
                if v:
                    vals = v if isinstance(v, list) else [v]
                    events.append({"type": k.replace(" Date", ""), "date": ", ".join(str(x)[:10] for x in vals), "detail": "(scheduled)"})
    except Exception:
        pass
    try:
        acts = tk.actions
        if acts is not None and not acts.empty:
            for idx, r in acts.tail(8).iloc[::-1].iterrows():
                if r.get("Dividends", 0):
                    events.append({"type": "Dividend", "date": idx.strftime("%Y-%m-%d"), "detail": f"{r['Dividends']:.2f} per share"})
                if r.get("Stock Splits", 0):
                    events.append({"type": "Split/bonus", "date": idx.strftime("%Y-%m-%d"), "detail": f"ratio {r['Stock Splits']:g}"})
    except Exception:
        pass
    name = info.get("shortName") or info.get("longName") or symbol
    q = urllib.parse.quote(f'"{name}" stock' if is_us(symbol) else f'"{name}" share OR stock OR results')
    region = "hl=en-US&gl=US&ceid=US:en" if is_us(symbol) else "hl=en-IN&gl=IN&ceid=IN:en"
    news = []
    try:
        f = feedparser.parse(f"https://news.google.com/rss/search?q={q}&{region}")
        for e in f.entries[:15]:
            ts = e.get("published_parsed")
            news.append({"title": e.get("title"), "link": e.get("link"), "source": (e.get("source") or {}).get("title", "Google News"),
                         "time": dt.datetime(*ts[:6], tzinfo=dt.timezone.utc).isoformat() if ts else None})
    except Exception as ex:
        log.warning("company news failed: %s", ex)
    out = {"name": name, "summary": info.get("longBusinessSummary"), "industry": info.get("industry"), "sector": info.get("sector"),
           "website": info.get("website"), "employees": info.get("fullTimeEmployees"), "city": info.get("city"),
           "officers": [{"name": o.get("name"), "title": o.get("title")} for o in (info.get("companyOfficers") or [])[:5]],
           "events": events, "news": news}
    _CCACHE[symbol] = (time.time(), out)
    return out


class AskIn(BaseModel):
    symbol: str
    question: str
    context: str


@app.post("/ask", dependencies=[Depends(auth)])
def ask(a: AskIn):
    """Company Q&A through the Anthropic Messages API. Needs "anthropic_api_key" in config.json."""
    import urllib.request
    key = cfg("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise HTTPException(400, "Set anthropic_api_key in bridge/config.json (or ANTHROPIC_API_KEY) to use the AI analyst.")
    model = cfg("anthropic_model", "claude-sonnet-5-5")
    system = ("You are an equity research analyst for Indian (NSE/BSE) and US markets. Answer the user's question about the company "
              "using the JSON dossier provided (prices, fundamentals, valuation, technicals, scenarios, drivers, risks, events, headlines) "
              "and your general knowledge of the business. Be specific and quantitative, structure the answer with short headings and bullets, "
              "give entry/exit levels when asked, separate facts in the dossier from your own judgement, flag if data_source says 'sim' "
              "(simulated demo data), and end with one line noting this is analysis, not investment advice.")
    body = json.dumps({"model": model, "max_tokens": 1500, "system": system,
                       "messages": [{"role": "user", "content": f"Dossier:\n{a.context[:60000]}\n\nQuestion: {a.question}"}]}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, method="POST",
                                 headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=110) as r:
            resp = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise HTTPException(e.code, e.read().decode()[:300])
    text = "".join(b.get("text", "") for b in resp.get("content", []) if b.get("type") == "text")
    return {"answer": text, "model": resp.get("model", model)}


# ---- general AI endpoint (market brief, document Q&A) --------------------------
AI_SYSTEMS = {
    "brief": ("You are the chief market strategist of an Indian equity desk. Using ONLY the JSON/market context provided, write today's "
              "pre-market brief for NSE/BSE: 1) one-paragraph market read, 2) global cues and what they mean for Indian sectors, "
              "3) sectors to favour / avoid, 4) the opportunity list with one line each, 5) risks and events to watch, 6) a 3-bullet game plan. "
              "Be concise, quantitative and neutral; flag if the context says the data is simulated; end with one line noting it is not investment advice."),
    "doc": ("You are an equity research analyst reading a company document (annual report, earnings-call transcript or filing). Answer the "
            "question using ONLY the numbered excerpts provided, quoting figures exactly and citing pages like [p. 12]. If the excerpts do "
            "not contain the answer, say so. Structure with short headings and bullets."),
}


class AiIn(BaseModel):
    task: str = "doc"
    prompt: str
    context: str


@app.post("/ai", dependencies=[Depends(auth)])
def ai(a: AiIn):
    key = cfg("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise HTTPException(400, "Set anthropic_api_key in bridge/config.json (or ANTHROPIC_API_KEY) to use AI features.")
    model = cfg("anthropic_model", "claude-sonnet-5-5")
    body = json.dumps({"model": model, "max_tokens": 2000, "system": AI_SYSTEMS.get(a.task, AI_SYSTEMS["doc"]),
                       "messages": [{"role": "user", "content": f"Context:\n{a.context[:120000]}\n\nTask: {a.prompt}"}]}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, method="POST",
                                 headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=150) as r:
            resp = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise HTTPException(e.code, e.read().decode()[:300])
    return {"answer": "".join(b.get("text", "") for b in resp.get("content", []) if b.get("type") == "text"), "model": resp.get("model", model)}


# ---- daily broker logins ------------------------------------------------------
@app.get("/login/zerodha")
def login_zerodha():
    from kiteconnect import KiteConnect
    return RedirectResponse(KiteConnect(api_key=cfg("zerodha.api_key")).login_url())


@app.get("/callback/zerodha")
def callback_zerodha(request_token: str):
    from kiteconnect import KiteConnect
    k = KiteConnect(api_key=cfg("zerodha.api_key"))
    s = k.generate_session(request_token, api_secret=cfg("zerodha.api_secret"))
    save_token("zerodha", s["access_token"])
    return JSONResponse({"status": "Zerodha session saved for today. You can close this tab."})


@app.get("/login/fyers")
def login_fyers():
    from fyers_apiv3 import fyersModel
    sess = fyersModel.SessionModel(client_id=cfg("fyers.client_id"), secret_key=cfg("fyers.secret_key"), redirect_uri=cfg("fyers.redirect_uri", "http://127.0.0.1:8765/callback/fyers"), response_type="code", grant_type="authorization_code")
    return RedirectResponse(sess.generate_authcode())


@app.get("/callback/fyers")
def callback_fyers(auth_code: str):
    from fyers_apiv3 import fyersModel
    sess = fyersModel.SessionModel(client_id=cfg("fyers.client_id"), secret_key=cfg("fyers.secret_key"), redirect_uri=cfg("fyers.redirect_uri", "http://127.0.0.1:8765/callback/fyers"), response_type="code", grant_type="authorization_code")
    sess.set_token(auth_code)
    r = sess.generate_token()
    if "access_token" not in r:
        raise HTTPException(400, str(r))
    save_token("fyers", r["access_token"])
    return JSONResponse({"status": "Fyers session saved for today. You can close this tab."})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=cfg("host", "127.0.0.1"), port=int(cfg("port", 8765)))

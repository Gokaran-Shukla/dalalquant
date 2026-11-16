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
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
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


PROVIDERS = {"yahoo": YahooProvider, "zerodha": ZerodhaProvider, "fyers": FyersProvider, "dhan": DhanProvider, "angel": AngelProvider, "groww": GrowwProvider}


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

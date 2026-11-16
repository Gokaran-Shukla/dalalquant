"""
NSE public data for DalalQuant — end-of-day prices with delivery %, F&O bhavcopy, FII/DII flows,
bulk/block deals, insider (PIT) disclosures and promoter pledges.

Everything here comes from files and JSON that NSE publishes on nseindia.com / nsearchives.nseindia.com.
Use it for personal research, keep the request rate low (this module sleeps between downloads and caches
every file on disk) and check NSE's website terms of use. NSE changes URLs and formats from time to time;
each loader tries the current format first and falls back where a fallback exists.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import logging
import threading
import time
import zipfile
from pathlib import Path
from typing import Any

log = logging.getLogger("dalalquant.nse")
CACHE = Path(__file__).resolve().parent / "cache"
(CACHE / "eq").mkdir(parents=True, exist_ok=True)
(CACHE / "fo").mkdir(parents=True, exist_ok=True)
(CACHE / "json").mkdir(parents=True, exist_ok=True)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9", "Referer": "https://www.nseindia.com/"}
_SESSION = None
_LOCK = threading.Lock()
STATUS: dict[str, Any] = {"syncing": False, "done": 0, "total": 0, "last": None, "errors": 0}


def session():
    """requests.Session primed with NSE cookies (needed for www.nseindia.com/api/*)."""
    global _SESSION
    import requests
    if _SESSION is None or time.time() - getattr(_SESSION, "_t", 0) > 600:
        s = requests.Session()
        s.headers.update(HEADERS)
        try:
            s.get("https://www.nseindia.com/", timeout=15)
        except Exception as e:  # archives work without cookies
            log.warning("NSE home: %s", e)
        s._t = time.time()
        _SESSION = s
    return _SESSION


def _get(url: str, timeout: int = 30) -> bytes | None:
    try:
        r = session().get(url, timeout=timeout)
        if r.status_code == 200 and r.content:
            return r.content
        log.debug("GET %s -> %s", url, r.status_code)
    except Exception as e:
        log.debug("GET %s failed: %s", url, e)
    return None


def _unzip_first(b: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(b)) as z:
        return z.read(z.namelist()[0]).decode("utf-8", "replace")


# --------------------------------------------------------------------------- parsing (unit-tested)
def parse_full_bhav(text: str) -> list[dict]:
    """sec_bhavdata_full_DDMMYYYY.csv → rows with OHLC, volume, turnover and delivery %."""
    out = []
    rd = csv.DictReader(io.StringIO(text))
    rd.fieldnames = [f.strip().upper() for f in (rd.fieldnames or [])]
    for r in rd:
        r = {k.strip().upper(): (v or "").strip() for k, v in r.items() if k}
        if r.get("SERIES") not in ("EQ", "BE", "BZ", "SM", "ST"):
            continue
        try:
            d = dt.datetime.strptime(r["DATE1"], "%d-%b-%Y").date().isoformat()
            dp = r.get("DELIV_PER", "")
            out.append({"sym": r["SYMBOL"], "t": d, "o": float(r["OPEN_PRICE"]), "h": float(r["HIGH_PRICE"]), "l": float(r["LOW_PRICE"]),
                        "c": float(r["CLOSE_PRICE"]), "pc": float(r["PREV_CLOSE"]), "v": float(r["TTL_TRD_QNTY"]),
                        "val": float(r.get("TURNOVER_LACS") or 0) / 100, "dq": float(r["DELIV_QTY"]) if r.get("DELIV_QTY", "-") not in ("-", "") else None,
                        "dp": float(dp) if dp not in ("-", "") else None})
        except (KeyError, ValueError):
            continue
    return out


def parse_udiff_cm(text: str) -> list[dict]:
    """New (UDiFF, July 2024+) CM bhavcopy BhavCopy_NSE_CM_0_0_0_YYYYMMDD_F_0000.csv."""
    out = []
    for r in csv.DictReader(io.StringIO(text)):
        if r.get("SctySrs") not in ("EQ", "BE", "BZ", "SM", "ST"):
            continue
        try:
            out.append({"sym": r["TckrSymb"], "t": r["TradDt"][:10], "o": float(r["OpnPric"]), "h": float(r["HghPric"]), "l": float(r["LwPric"]),
                        "c": float(r["ClsPric"]), "pc": float(r["PrvsClsgPric"]), "v": float(r["TtlTradgVol"]), "val": float(r["TtlTrfVal"]) / 1e7,
                        "dq": None, "dp": None})
        except (KeyError, ValueError):
            continue
    return out


def parse_udiff_fo(text: str) -> list[dict]:
    """F&O UDiFF bhavcopy → futures and options rows with OI and change in OI."""
    out = []
    for r in csv.DictReader(io.StringIO(text)):
        try:
            out.append({"t": r["TradDt"][:10], "sym": r["TckrSymb"], "type": r["FinInstrmTp"], "exp": r["XpryDt"][:10],
                        "k": float(r["StrkPric"] or 0), "opt": r.get("OptnTp", ""), "c": float(r["ClsPric"] or 0),
                        "pc": float(r["PrvsClsgPric"] or 0), "u": float(r.get("UndrlygPric") or 0),
                        "oi": float(r["OpnIntrst"] or 0), "doi": float(r["ChngInOpnIntrst"] or 0), "v": float(r.get("TtlTradgVol") or 0)})
        except (KeyError, ValueError):
            continue
    return out


def parse_participant_oi(text: str) -> dict:
    """fao_participant_oi_DDMMYYYY.csv → {Client|DII|FII|Pro: {fut_idx_long, fut_idx_short, ...}}."""
    lines = [l for l in text.splitlines() if l.strip()]
    hdr_i = next(i for i, l in enumerate(lines) if l.lower().startswith("client type"))
    rd = csv.reader(lines[hdr_i:])
    hdr = [h.strip() for h in next(rd)]
    out = {}
    for row in rd:
        if not row or row[0].strip().upper() == "TOTAL":
            continue
        rec = dict(zip(hdr, [x.strip() for x in row]))
        key = rec.get("Client Type", "").strip()
        num = lambda k: float(rec.get(k, "0").replace(",", "") or 0)
        out[key] = {"fut_idx_long": num("Future Index Long"), "fut_idx_short": num("Future Index Short"),
                    "fut_stk_long": num("Future Stock Long"), "fut_stk_short": num("Future Stock Short\t") or num("Future Stock Short"),
                    "call_idx_long": num("Option Index Call Long"), "put_idx_long": num("Option Index Put Long"),
                    "call_idx_short": num("Option Index Call Short"), "put_idx_short": num("Option Index Put Short")}
    return out


def parse_deals_csv(text: str, kind: str) -> list[dict]:
    out = []
    rd = csv.DictReader(io.StringIO(text))
    for r in rd:
        r = {(k or "").strip(): (v or "").strip() for k, v in r.items()}
        try:
            out.append({"kind": kind, "date": r.get("Date"), "sym": r.get("Symbol"), "client": r.get("Client Name"),
                        "side": r.get("Buy/Sell"), "qty": float((r.get("Quantity Traded") or "0").replace(",", "")),
                        "price": float((r.get("Trade Price / Wght. Avg. Price") or r.get("Trade Price") or "0").replace(",", ""))})
        except ValueError:
            continue
    return out


# --------------------------------------------------------------------------- downloads + cache
def _days_back(n: int):
    d = dt.date.today()
    while n > 0:
        if d.weekday() < 5:
            yield d
            n -= 1
        d -= dt.timedelta(days=1)


def fetch_eq_day(d: dt.date) -> list[dict] | None:
    f = CACHE / "eq" / f"{d:%Y%m%d}.json"
    if f.exists():
        return json.loads(f.read_text())
    b = _get(f"https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{d:%d%m%Y}.csv")
    rows = parse_full_bhav(b.decode("utf-8", "replace")) if b else None
    if not rows:
        z = _get(f"https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{d:%Y%m%d}_F_0000.csv.zip")
        rows = parse_udiff_cm(_unzip_first(z)) if z else None
    if rows:
        f.write_text(json.dumps(rows))
    elif d < dt.date.today():
        f.write_text("[]")  # holiday: remember so we do not retry
    return rows


def fetch_fo_day(d: dt.date) -> list[dict] | None:
    f = CACHE / "fo" / f"{d:%Y%m%d}.json"
    if f.exists():
        return json.loads(f.read_text())
    z = _get(f"https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{d:%Y%m%d}_F_0000.csv.zip")
    rows = parse_udiff_fo(_unzip_first(z)) if z else None
    if rows:
        keep = [r for r in rows if r["type"] in ("STF", "IDF") or abs(r["k"] - r["u"]) <= 0.15 * max(r["u"], 1)]
        f.write_text(json.dumps(keep))
        return keep
    if d < dt.date.today():
        f.write_text("[]")
    return rows


def sync(days: int = 760, fo_days: int = 60):
    """Download missing end-of-day files (runs in a background thread)."""
    if STATUS["syncing"]:
        return
    STATUS.update(syncing=True, done=0, total=days + fo_days, errors=0)
    try:
        for d in _days_back(days):
            fresh = not (CACHE / "eq" / f"{d:%Y%m%d}.json").exists()
            if fetch_eq_day(d) is None:
                STATUS["errors"] += 1
            STATUS["done"] += 1
            if fresh:
                time.sleep(0.6)
        for d in _days_back(fo_days):
            fresh = not (CACHE / "fo" / f"{d:%Y%m%d}.json").exists()
            fetch_fo_day(d)
            STATUS["done"] += 1
            if fresh:
                time.sleep(0.6)
        _INDEX.clear()
        STATUS["last"] = dt.datetime.now().isoformat()
    finally:
        STATUS["syncing"] = False


_INDEX: dict[str, list[dict]] = {}


def _build_index():
    if _INDEX:
        return
    with _LOCK:
        if _INDEX:
            return
        for f in sorted((CACHE / "eq").glob("*.json")):
            try:
                for r in json.loads(f.read_text()):
                    _INDEX.setdefault(r["sym"], []).append(r)
            except Exception:
                continue


def adjust_splits(bars: list[dict], splits: list[tuple[str, float]]) -> list[dict]:
    """Back-adjust prices (and volumes) for splits/bonuses: splits = [(ex_date, ratio)], ratio = new/old shares."""
    out = [dict(b) for b in bars]
    for ex, ratio in splits:
        if not ratio or ratio == 1:
            continue
        for b in out:
            if b["t"] < ex:
                for k in ("o", "h", "l", "c", "pc"):
                    if k in b and b[k] is not None:
                        b[k] = b[k] / ratio
                b["v"] = b["v"] * ratio
    return out


def detect_splits(bars: list[dict]) -> list[tuple[str, float]]:
    """Infer splits/bonuses where open/prev-close gaps match a common ratio (fallback when no corporate-action feed)."""
    found = []
    for i in range(1, len(bars)):
        pc, o = bars[i - 1]["c"], bars[i]["o"]
        if pc <= 0 or o <= 0:
            continue
        r = pc / o
        for ratio in (2, 3, 4, 5, 10, 1.5, 2.5):
            if abs(r - ratio) / ratio < 0.04:
                found.append((bars[i]["t"], float(ratio)))
                break
    return found


def history(symbol: str, days: int = 1100, adjust: bool = True) -> list[dict]:
    _build_index()
    rows = sorted(_INDEX.get(symbol, []), key=lambda r: r["t"])[-days:]
    bars = [{"t": r["t"], "o": r["o"], "h": r["h"], "l": r["l"], "c": r["c"], "v": r["v"], "d": r.get("dp")} for r in rows]
    if adjust and bars:
        sp = []
        try:
            import yfinance as yf
            s = yf.Ticker(symbol + ".NS").splits
            sp = [(i.strftime("%Y-%m-%d"), float(v)) for i, v in s.items() if v and v != 1]
        except Exception:
            sp = detect_splits(bars)
        bars = adjust_splits(bars, sp)
    return bars


def quotes(symbols: list[str]) -> dict:
    _build_index()
    out = {}
    for s in symbols:
        rows = _INDEX.get(s)
        if rows:
            r = max(rows, key=lambda x: x["t"])
            out[s] = {"ltp": r["c"], "open": r["o"], "high": r["h"], "low": r["l"], "prev_close": r["pc"], "volume": r["v"], "deliv_pct": r.get("dp")}
    return out


# --------------------------------------------------------------------------- flows, deals, disclosures
def _api(path: str, ttl: int = 1800):
    key = CACHE / "json" / (path.replace("/", "_").replace("?", "_").replace("&", "_").replace("=", "-")[:150] + ".json")
    if key.exists() and time.time() - key.stat().st_mtime < ttl:
        return json.loads(key.read_text())
    b = _get("https://www.nseindia.com/api/" + path)
    if not b:
        return json.loads(key.read_text()) if key.exists() else None
    try:
        data = json.loads(b)
    except ValueError:
        return None
    key.write_text(json.dumps(data))
    return data


FII_HIST = CACHE / "fiidii_history.json"


def fii_dii() -> dict:
    """Today's provisional FII/DII cash-market flows (₹ crore); appended to a local history file each day."""
    data = _api("fiidiiTradeReact", ttl=900) or []
    hist = json.loads(FII_HIST.read_text()) if FII_HIST.exists() else {}
    for r in data:
        d = r.get("date")
        cat = "FII" if "FII" in r.get("category", "").upper() or "FPI" in r.get("category", "").upper() else "DII"
        try:
            hist.setdefault(d, {})[cat] = {"buy": float(r["buyValue"]), "sell": float(r["sellValue"]), "net": float(r["netValue"])}
        except (KeyError, ValueError):
            continue
    FII_HIST.write_text(json.dumps(hist))
    rows = []
    for d, v in hist.items():
        try:
            rows.append({"date": dt.datetime.strptime(d, "%d-%b-%Y").date().isoformat(), **{k.lower(): v.get(k, {}).get("net") for k in ("FII", "DII")}})
        except ValueError:
            continue
    rows.sort(key=lambda r: r["date"])
    return {"today": data, "history": rows}


def deals() -> list[dict]:
    out = []
    for kind in ("bulk", "block"):
        b = _get(f"https://nsearchives.nseindia.com/content/equities/{kind}.csv")
        if b:
            out += parse_deals_csv(b.decode("utf-8", "replace"), kind)
    return out


def insider(symbol: str | None = None, days: int = 90) -> list[dict]:
    to = dt.date.today()
    frm = to - dt.timedelta(days=days)
    q = f"corporates-pit?index=equities&from_date={frm:%d-%m-%Y}&to_date={to:%d-%m-%Y}" + (f"&symbol={symbol}" if symbol else "")
    data = _api(q, ttl=6 * 3600) or {}
    rows = data.get("data", []) if isinstance(data, dict) else []
    return [{"sym": r.get("symbol"), "who": r.get("acqName"), "cat": r.get("personCategory"), "type": r.get("tdpTransactionType") or r.get("acqMode"),
             "qty": r.get("secAcq"), "value": r.get("secVal"), "date": r.get("date") or r.get("acqfromDt")} for r in rows]


def pledges() -> list[dict]:
    data = _api("corporate-pledgedata?index=equities", ttl=12 * 3600) or {}
    rows = data.get("data", []) if isinstance(data, dict) else []
    return [{"sym": r.get("symbol") or r.get("comName"), "promoterPct": r.get("percPromoterHolding") or r.get("per1"), "pledgedPct": r.get("percSharesPledged") or r.get("per3"),
             "date": r.get("shp") or r.get("broadcastDt")} for r in rows]


# --------------------------------------------------------------------------- F&O analytics
def fo_buildup(day: dt.date | None = None) -> list[dict]:
    """Classify near-month stock futures: long build-up / short build-up / short covering / long unwinding."""
    for d in ([day] if day else list(_days_back(5))):
        rows = fetch_fo_day(d) or []
        fut = [r for r in rows if r["type"] in ("STF", "IDF")]
        if fut:
            break
    else:
        return []
    near: dict[str, dict] = {}
    for r in fut:
        if r["sym"] not in near or r["exp"] < near[r["sym"]]["exp"]:
            near[r["sym"]] = r
    out = []
    for s, r in near.items():
        if not r["pc"] or not r["oi"]:
            continue
        pch = r["c"] / r["pc"] - 1
        oich = r["doi"] / max(r["oi"] - r["doi"], 1)
        cls = ("Long build-up" if pch > 0 and oich > 0 else "Short build-up" if pch < 0 and oich > 0
               else "Short covering" if pch > 0 else "Long unwinding")
        out.append({"sym": s, "t": r["t"], "exp": r["exp"], "price": r["c"], "chg": pch, "oi": r["oi"], "oichg": oich, "class": cls})
    return out


def rollover(symbol: str) -> dict | None:
    for d in _days_back(5):
        rows = [r for r in (fetch_fo_day(d) or []) if r["sym"] == symbol and r["type"] in ("STF", "IDF")]
        if rows:
            rows.sort(key=lambda r: r["exp"])
            tot = sum(r["oi"] for r in rows)
            return {"date": rows[0]["t"], "near": rows[0]["oi"], "next": sum(r["oi"] for r in rows[1:]), "rollover": (tot - rows[0]["oi"]) / tot if tot else None,
                    "series": [{"exp": r["exp"], "oi": r["oi"], "price": r["c"]} for r in rows]}
    return None


def participant_oi() -> dict | None:
    for d in _days_back(5):
        b = _get(f"https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_{d:%d%m%Y}.csv")
        if b:
            try:
                return {"date": d.isoformat(), "data": parse_participant_oi(b.decode("utf-8", "replace"))}
            except Exception as e:
                log.warning("participant OI parse: %s", e)
    return None


def option_history(symbol: str, days: int = 60) -> list[dict]:
    """ATM straddle and implied-vol proxy per day from cached F&O bhavcopies (for IV-rank)."""
    out = []
    for d in sorted(_days_back(days)):
        rows = [r for r in (fetch_fo_day(d) or []) if r["sym"] == symbol and r["type"] in ("STO", "IDO")]
        if not rows:
            continue
        exp = min(r["exp"] for r in rows)
        rows = [r for r in rows if r["exp"] == exp]
        u = rows[0]["u"]
        k = min({r["k"] for r in rows}, key=lambda x: abs(x - u))
        ce = next((r["c"] for r in rows if r["k"] == k and r["opt"] == "CE"), None)
        pe = next((r["c"] for r in rows if r["k"] == k and r["opt"] == "PE"), None)
        if ce and pe and u:
            T = max((dt.date.fromisoformat(exp) - d).days, 1) / 365
            iv = (ce + pe) / u / 0.8 / (T ** 0.5)  # straddle ≈ 0.8·S·σ·√T
            out.append({"t": d.isoformat(), "u": u, "k": k, "straddle": ce + pe, "iv": iv, "exp": exp})
    return out

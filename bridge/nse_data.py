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


# --------------------------------------------------------------------------- special situations
SPECIAL_WORDS = ("buyback", "buy back", "open offer", "delisting", "demerger", "scheme of arrangement", "bonus", "split", "sub-division", "merger", "amalgamation", "rights issue")


def announcements(days: int = 30) -> list[dict]:
    to = dt.date.today()
    frm = to - dt.timedelta(days=days)
    data = _api(f"corporate-announcements?index=equities&from_date={frm:%d-%m-%Y}&to_date={to:%d-%m-%Y}", ttl=1800) or []
    rows = data if isinstance(data, list) else data.get("data", [])
    out = []
    for r in rows:
        txt = f"{r.get('desc', '')} {r.get('attchmntText', '')}".lower()
        hit = next((w for w in SPECIAL_WORDS if w in txt), None)
        if hit:
            out.append({"sym": r.get("symbol"), "date": r.get("an_dt") or r.get("sort_date"), "type": hit, "desc": r.get("desc"),
                        "text": (r.get("attchmntText") or "")[:400], "link": r.get("attchmntFile")})
    return out


def fno_ban() -> dict:
    b = _get("https://nsearchives.nseindia.com/content/fo/fo_secban.csv")
    if not b:
        return {"date": None, "symbols": []}
    lines = [l.strip() for l in b.decode("utf-8", "replace").splitlines() if l.strip()]
    head = lines[0] if lines else ""
    syms = []
    for l in lines[1:]:
        parts = [p.strip() for p in l.split(",") if p.strip()]
        if parts:
            syms.append(parts[-1])
    return {"date": head, "symbols": syms}


# ---- master list of NSE equities and ETFs (for symbol search) -------------------------------------
_EQL: dict[str, Any] = {"t": 0, "rows": []}


def equity_list() -> list[dict]:
    """All NSE-listed equities (EQUITY_L.csv) and ETFs, cached for a week on disk."""
    import csv
    import io
    if _EQL["rows"] and time.time() - _EQL["t"] < 86400:
        return _EQL["rows"]
    f = CACHE / "json" / "equity_list.json"
    if f.exists() and time.time() - f.stat().st_mtime < 7 * 86400:
        try:
            _EQL.update(t=time.time(), rows=json.loads(f.read_text()))
            return _EQL["rows"]
        except Exception:  # noqa: BLE001
            pass
    rows: list[dict] = []
    b = _get("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv") or _get("https://archives.nseindia.com/content/equities/EQUITY_L.csv")
    if b:
        for r in csv.DictReader(io.StringIO(b.decode("utf-8", "ignore"))):
            r = {k.strip().upper(): (v or "").strip() for k, v in r.items() if k}
            if r.get("SYMBOL") and r.get("SERIES") in ("EQ", "BE", "BZ", "SM", "ST", ""):
                rows.append({"sym": r["SYMBOL"], "name": r.get("NAME OF COMPANY", r["SYMBOL"]).title(), "exch": "NSE", "type": "stock",
                             "isin": r.get("ISIN NUMBER", ""), "listed": r.get("DATE OF LISTING", "")})
    e = _get("https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv")
    if e:
        for r in csv.DictReader(io.StringIO(e.decode("utf-8", "ignore"))):
            r = {k.strip().upper(): (v or "").strip() for k, v in r.items() if k}
            sym = r.get("SYMBOL")
            if sym:
                rows.append({"sym": sym, "name": r.get("SECURITY NAME") or r.get("UNDERLYING") or sym, "exch": "NSE", "type": "etf",
                             "underlying": r.get("UNDERLYING", "")})
    if rows:
        f.write_text(json.dumps(rows))
        _EQL.update(t=time.time(), rows=rows)
    elif f.exists():
        _EQL.update(t=time.time(), rows=json.loads(f.read_text()))
    return _EQL["rows"]


# ---- whole-market volatility scan (from the cached NSE EOD bhavcopies) -------------------------------
_IDX_FILES = {"n": 0}


def _refresh_index():
    n = len(list((CACHE / "eq").glob("*.json")))
    if n != _IDX_FILES["n"]:
        with _LOCK:
            _INDEX.clear()
        _IDX_FILES["n"] = n
    _build_index()


def vol_scan(years: float = 2, min_turnover_cr: float = 1.0) -> dict:
    """Volatility statistics for every NSE equity in the EOD cache.
    Returns use NSE's PREV_CLOSE, which is already adjusted for splits/bonuses, so corporate actions do not show as moves."""
    _refresh_index()
    names = {r["sym"]: r["name"] for r in equity_list() if r.get("type") == "stock"}
    n = int(years * 248)
    days = len({r["t"] for rows in list(_INDEX.values())[:50] for r in rows})
    out = []
    for sym, rows in _INDEX.items():
        rows = sorted(rows, key=lambda r: r["t"])[-n:]
        if len(rows) < 60:
            continue
        rets, rng, d5, d6, d8, d10, mx, mn, last10 = [], [], 0, 0, 0, 0, 0.0, 0.0, None
        for r in rows:
            pc = r.get("pc") or 0
            if pc <= 0 or r["c"] <= 0:
                continue
            ret = r["c"] / pc - 1
            if abs(ret) > 0.6:      # data glitch / relisting
                continue
            hi, lo = r["h"] or r["c"], r["l"] or r["c"]
            sw = max(abs(ret), hi / pc - 1, 1 - lo / pc)
            rets.append(ret)
            rng.append((hi - lo) / pc)
            d5 += sw >= 0.05
            d6 += sw >= 0.06
            d8 += sw >= 0.08
            if sw >= 0.10:
                d10 += 1
                last10 = r["t"]
            mx, mn = max(mx, ret), min(mn, ret)
        if len(rets) < 40:
            continue
        turn = sum(r.get("val", 0) for r in rows[-60:]) / min(60, len(rows))
        if turn < min_turnover_cr:
            continue
        m = sum(rets) / len(rets)
        sd = (sum((x - m) ** 2 for x in rets) / max(1, len(rets) - 1)) ** 0.5
        yrs = len(rets) / 248
        out.append({"sym": sym, "name": names.get(sym, sym), "price": rows[-1]["c"], "last": rows[-1]["t"], "n": len(rets),
                    "vol": sd * 248 ** 0.5, "adr": sum(rng) / len(rng), "f5": d5 / yrs, "f10": d10 / yrs, "d5": d5, "d6": d6, "d8": d8, "d10": d10, "yrs": yrs,
                    "maxU": mx, "maxD": mn, "last10": last10, "turnover_cr": turn})
    return {"rows": out, "cached_days": len(list((CACHE / "eq").glob("*.json"))), "sample_days": days}


# ---- official market-cap ranking (AMFI half-yearly list: Large 1-100, Mid 101-250, Small 251+) ------------
def _amfi_parse(b: bytes) -> dict:
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(b), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    hdr, out = None, {}
    for row in ws.iter_rows(values_only=True):
        cells = [str(c).strip() if c is not None else "" for c in row]
        if hdr is None:
            low = [c.lower() for c in cells]
            if any("nse symbol" in c for c in low):
                hdr = low
                ci = {"rank": next((i for i, c in enumerate(low) if c.startswith("sr")), 0),
                      "name": next((i for i, c in enumerate(low) if "company" in c), 1),
                      "nse": next(i for i, c in enumerate(low) if "nse symbol" in c),
                      "avg": next((i for i, c in enumerate(low) if "average of all" in c), None),
                      "cat": next((i for i, c in enumerate(low) if "categor" in c), None)}
            continue
        sym = cells[ci["nse"]] if ci["nse"] < len(cells) else ""
        if not sym or sym.upper() in ("NA", "-", "N.A."):
            continue
        try:
            mc = float(cells[ci["avg"]].replace(",", "")) if ci["avg"] is not None and cells[ci["avg"]] else None
        except ValueError:
            mc = None
        try:
            rank = int(float(cells[ci["rank"]]))
        except ValueError:
            rank = None
        cat = cells[ci["cat"]].split()[0].title() if ci["cat"] is not None and cells[ci["cat"]] else None
        out[sym.upper()] = {"rank": rank, "mcap_cr": mc, "cat": cat, "name": cells[ci["name"]]}
    return out


def amfi_mcap() -> dict:
    """{NSE symbol: {rank, mcap_cr, cat}} from AMFI's 'Average Market Capitalisation' list (cached 30 days).
    Drop the AMFI .xlsx into bridge/cache/ to use a specific edition."""
    f = CACHE / "json" / "amfi_mcap.json"
    if f.exists() and time.time() - f.stat().st_mtime < 30 * 86400:
        try:
            return json.loads(f.read_text())
        except Exception:  # noqa: BLE001
            pass
    for x in sorted(CACHE.glob("*.xlsx"), key=lambda p: p.stat().st_mtime, reverse=True):
        if "market" in x.name.lower() or "amfi" in x.name.lower():
            try:
                d = {"period": x.stem, "src": "local file", "rows": _amfi_parse(x.read_bytes())}
                if len(d["rows"]) > 500:
                    f.write_text(json.dumps(d))
                    return d
            except Exception as e:  # noqa: BLE001
                log.warning("AMFI file %s: %s", x.name, e)
    today = dt.date.today()
    cands = []
    for y in range(today.year, today.year - 3, -1):
        for md in ((12, 31), (6, 30)):
            d = dt.date(y, *md)
            if d < today:
                cands.append(d)
    for d in cands[:5]:
        for url in (f"https://www.amfiindia.com/Themes/Theme1/downloads/AverageMarketCapitalization{d:%d%b%Y}.xlsx",
                    f"https://portal.amfiindia.com/spages/AverageMarketCapitalization{d:%d%b%Y}.xlsx"):
            b = _get(url)
            if b and b[:2] == b"PK":
                try:
                    rows = _amfi_parse(b)
                    if len(rows) > 500:
                        res = {"period": f"{d:%d %b %Y}", "src": url, "rows": rows}
                        f.write_text(json.dumps(res))
                        return res
                except Exception as e:  # noqa: BLE001
                    log.warning("AMFI parse %s: %s", url, e)
    return {"period": None, "src": None, "rows": {}}

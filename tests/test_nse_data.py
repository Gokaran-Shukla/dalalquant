import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "bridge"))
import nse_data as n

FULL = """SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER
INFY, EQ, 14-Nov-2026, 1500.00, 1505.00, 1520.00, 1498.00, 1515.00, 1516.50, 1510.20, 5000000, 75510.00, 120000, 2500000, 50.00
INFY, N1, 14-Nov-2026, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -, -
XYZ, BE, 14-Nov-2026, 10.00, 10.10, 10.50, 9.90, 10.20, 10.25, 10.20, 1000, 0.10, 10, -, -
"""
UDIFF_FO = """TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4
2026-11-14,2026-11-14,FO,NSE,STF,1,,INFY,,2026-11-27,2026-11-27,,,INFY26NOVFUT,1500,1525,1495,1520,1520,1500,1516,1520,1000000,100000,5000,0,0,F1,400,,,,,
2026-11-14,2026-11-14,FO,NSE,STF,2,,INFY,,2026-12-25,2026-12-25,,,INFY26DECFUT,1510,1530,1500,1528,1528,1508,1516,1528,300000,50000,1000,0,0,F1,400,,,,,
2026-11-14,2026-11-14,FO,NSE,STF,3,,TCS,,2026-11-27,2026-11-27,,,TCS26NOVFUT,3000,3010,2950,2960,2960,3000,2955,2960,800000,80000,3000,0,0,F1,175,,,,,
"""
PART = """Participant wise Open Interest (no. of contracts) in Equity Derivatives as on Nov 14, 2026
Client Type,Future Index Long,Future Index Short,Future Stock Long,Future Stock Short\t,Option Index Call Long,Option Index Put Long,Option Index Call Short,Option Index Put Short,Option Stock Call Long,Option Stock Put Long,Option Stock Call Short,Option Stock Put Short,Total Long Contracts\t,Total Short Contracts\t
Client,100,200,300,400,500,600,700,800,1,2,3,4,5,6
FII,1000,3000,10,20,30,40,50,60,1,2,3,4,5,6
TOTAL,1,1,1,1,1,1,1,1,1,1,1,1,1,1
"""

def test_full_bhav():
    rows = n.parse_full_bhav(FULL)
    assert len(rows) == 2
    r = rows[0]
    assert r["sym"] == "INFY" and r["t"] == "2026-11-14" and r["c"] == 1516.5 and r["dp"] == 50.0 and abs(r["val"] - 755.1) < 1e-6
    assert rows[1]["dp"] is None

def test_fo_parse_and_buildup(monkeypatch):
    rows = n.parse_udiff_fo(UDIFF_FO)
    assert len(rows) == 3 and rows[0]["doi"] == 100000
    monkeypatch.setattr(n, "fetch_fo_day", lambda d: rows)
    b = {r["sym"]: r for r in n.fo_buildup(__import__("datetime").date(2026, 11, 14))}
    assert b["INFY"]["class"] == "Long build-up" and b["INFY"]["exp"] == "2026-11-27"
    assert b["TCS"]["class"] == "Short build-up"
    ro = n.rollover.__wrapped__ if hasattr(n.rollover, "__wrapped__") else None

def test_participant():
    d = n.parse_participant_oi(PART)
    assert d["FII"]["fut_idx_short"] == 3000 and d["Client"]["put_idx_long"] == 600 and "TOTAL" not in d

def test_split_adjust():
    bars = [{"t": "2026-01-01", "o": 200, "h": 210, "l": 190, "c": 200, "v": 10}, {"t": "2026-01-02", "o": 100, "h": 105, "l": 98, "c": 101, "v": 20}]
    sp = n.detect_splits(bars)
    assert sp == [("2026-01-02", 2.0)]
    adj = n.adjust_splits(bars, sp)
    assert adj[0]["c"] == 100 and adj[0]["v"] == 20 and adj[1]["c"] == 101

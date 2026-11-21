"""Tests for the live NSE/BSE feed hub (live_feed.py) and the market agent (agent.py). No network, no broker."""
import sys, pathlib, time, json
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "bridge"))
import live_feed as lf
import agent as ag

IDX = {"NIFTY 50", "NIFTY BANK", "SENSEX"}


def make_cfg(d):
    def cfg(path, default=None):
        cur = d
        for p in path.split("."):
            if not isinstance(cur, dict) or p not in cur:
                return default
            cur = cur[p]
        return cur
    return cfg


class NullAdapter(lf.FeedAdapter):
    name = "null"
    def start(self): self.hub.status(True)


def hub_and_agent(agent_cfg=None):
    cfg = make_cfg({"agent": agent_cfg or {}})
    hub = lf.FeedHub(lambda h: NullAdapter(h, {"cfg": cfg}), IDX)
    return hub, ag.MarketAgent(hub, cfg)


def test_symbol_keys():
    assert lf.split_key("BSE:tcs", IDX) == ("BSE", "TCS")
    assert lf.split_key("TCS", IDX) == ("NSE", "TCS")
    assert lf.split_key("SENSEX", IDX) == ("BSE", "SENSEX")
    assert lf.canon("nse:infy", IDX) == "INFY"
    assert lf.canon("BSE:INFY", IDX) == "BSE:INFY"
    assert lf.canon("NIFTY 50", IDX) == "NIFTY 50"


def test_refcounted_subscriptions():
    hub, _ = hub_and_agent()
    hub.subscribe(["INFY", "BSE:INFY"]); hub.subscribe(["INFY"])
    assert hub.subscribed() == ["BSE:INFY", "INFY"]
    hub.unsubscribe(["INFY"])
    assert "INFY" in hub.subscribed()
    hub.unsubscribe(["INFY", "BSE:INFY"])
    assert hub.subscribed() == []


def test_volume_diff_merge_and_minute_bars():
    hub, _ = hub_and_agent()
    bars = []
    hub.listeners.append(lambda k, x: bars.append(x) if k == "bar" else None)
    t0 = 1_800_000_000 - 1_800_000_000 % 60
    hub.on_tick({"k": "INFY", "x": "NSE", "ltp": 100.0, "pc": 98.0, "v": 1000, "ts": t0 + 1})
    hub.on_tick({"k": "INFY", "x": "NSE", "ltp": 101.0, "v": 1500, "ts": t0 + 30})       # partial update keeps pc
    hub.on_tick({"k": "INFY", "x": "NSE", "ltp": 99.5, "v": 1700, "ts": t0 + 59})
    hub.on_tick({"k": "INFY", "x": "NSE", "ltp": 99.0, "v": 1800, "ts": t0 + 61})        # closes the first minute
    last = hub.last["INFY"]
    assert last["pc"] == 98.0 and last["dv"] == 100 and abs(last["chg"] - (99 / 98 - 1)) < 1e-12
    assert len(bars) == 1
    b = bars[0]
    assert (b["o"], b["h"], b["l"], b["c"], b["v"]) == (100.0, 101.0, 99.5, 99.5, 700)


def test_fast_move_and_cooldown():
    hub, agent = hub_and_agent({"fast_pct": 1.0, "fast_window": 120, "cooldown": 600})
    now = time.time()
    hub.on_tick({"k": "TCS", "ltp": 1000.0, "ts": now - 60})
    hub.on_tick({"k": "TCS", "ltp": 1015.0, "ts": now})
    hub.on_tick({"k": "TCS", "ltp": 1016.0, "ts": now + 1})
    fast = [e for e in agent.events if e["type"] == "fast"]
    assert len(fast) == 1 and fast[0]["data"]["ret_pct"] > 1.4


def test_nse_bse_spread():
    hub, agent = hub_and_agent({"spread_bps": 20})
    hub.on_tick({"k": "SBIN", "ltp": 800.0})
    hub.on_tick({"k": "BSE:SBIN", "ltp": 802.0})   # +25 bps
    ev = [e for e in agent.events if e["type"] == "spread"]
    assert ev and abs(ev[0]["data"]["bps"] - 25) < 1e-6 and ev[0]["k"] == "SBIN"


def test_volume_surge_on_closed_bar():
    hub, agent = hub_and_agent({"surge_mult": 4.0, "surge_min_bars": 5})
    for i in range(10):
        agent._bar({"k": "ITC", "t": f"2026-11-20 10:{i:02d}", "o": 400, "h": 401, "l": 399, "c": 400, "v": 1000})
    agent._bar({"k": "ITC", "t": "2026-11-20 10:10", "o": 400, "h": 405, "l": 400, "c": 404, "v": 6000})
    ev = [e for e in agent.events if e["type"] == "volume"]
    assert len(ev) == 1 and "6.0×" in ev[0]["msg"]


def test_sim_feed_streams_both_exchanges():
    cfg = make_cfg({"live": {"sim_hz": 50}})
    hub = lf.FeedHub(lambda h: lf.SimFeed(h, {"cfg": cfg}), IDX)
    hub.subscribe(["RELIANCE", "BSE:RELIANCE", "SENSEX"])
    time.sleep(0.4)
    snap = hub.snapshot()
    assert set(snap) == {"RELIANCE", "BSE:RELIANCE", "SENSEX"}
    assert snap["BSE:RELIANCE"]["x"] == "BSE" and snap["RELIANCE"]["sim"] is True
    assert abs(snap["BSE:RELIANCE"]["ltp"] / snap["RELIANCE"]["ltp"] - 1) < 0.01
    hub.adapter.stop()


def test_ask_runs_tool_loop(monkeypatch):
    hub, agent = hub_and_agent()
    hub.on_tick({"k": "HDFCBANK", "ltp": 1700.0, "pc": 1680.0})
    calls = []

    def fake_claude(body, timeout=120):
        calls.append(body)
        if len(calls) == 1:
            assert {t["name"] for t in body["tools"]} >= {"get_quotes", "get_bars", "nse_bse_spread"}
            return {"stop_reason": "tool_use", "content": [{"type": "tool_use", "id": "t1", "name": "get_quotes", "input": {"symbols": ["HDFCBANK"]}}]}
        res = body["messages"][-1]["content"][0]
        assert res["type"] == "tool_result" and json.loads(res["content"])["HDFCBANK"]["ltp"] == 1700.0
        return {"stop_reason": "end_turn", "content": [{"type": "text", "text": "HDFCBANK ₹1,700 (+1.19%)."}]}

    monkeypatch.setattr(agent, "_claude", fake_claude)
    r = agent.ask("How is HDFC Bank trading?")
    assert r["answer"].startswith("HDFCBANK") and r["tools"][0]["tool"] == "get_quotes" and len(calls) == 2


def test_params_type_safety():
    _, agent = hub_and_agent()
    p = agent.set_params({"vwap_z": 3, "narrate": "yes", "bogus": 1, "notify_alerts": True})
    assert p["vwap_z"] == 3.0 and isinstance(p["vwap_z"], float) and p["narrate"] is False and p["notify_alerts"] is True and "bogus" not in p

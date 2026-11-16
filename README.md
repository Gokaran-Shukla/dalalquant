# DalalQuant — Indian markets terminal

**Live site:** https://gokaran-shukla.github.io/dalalquant

DalalQuant is a single-page terminal covering investing, trading and algo trading on NSE/BSE. It also includes US stocks, world indices, commodities, FX, bonds and crypto. Everything runs in your browser. The small optional **bridge** (`bridge/bridge.py`) adds real-time data, news and order routing through your own broker account.

## What's inside

| Section | Highlights |
|---|---|
| **India Markets** | Daily written briefing; all major NSE/BSE indices with sparklines; derived India VIX; breadth; sector heatmap; top gainers and losers; **Opportunities** (strong businesses well below their highs), which also pop up each time you open the terminal |
| **Market Mood · Sectors · Policy** | A fear–greed gauge built from 8–9 indicators (breadth, % of stocks above the 50/200-day averages, index momentum, VIX, 52-week highs vs lows, PCR, global cues, news tone), each explained in plain words; which sectors are **flourishing** and which are **under pressure**; a sector rotation map (leading / weakening / lagging / improving) and sector scoreboard; a **government policy tracker** (Budget 2026-27 capex, railways, defence, Semiconductor Mission 2.0, the 7-sector manufacturing push, PLI, energy storage, AI data centres) with named beneficiary stocks and whether the market is currently rewarding each theme; live policy headlines |
| **World · US · Commodities** | US, Europe, Asia-Pacific and Middle East indices; gold, silver, crude, gas and metals; INR crosses and DXY; US and India 10-year yields; crypto; rule-based **global cues for India** with the sectors each move affects; US stock rankings and sector heatmap |
| **News & Events** | Live RSS headlines (through the bridge), auto-tagged by topic (Fed, RBI, crude, tariffs, geopolitics, earnings, FII flows…) with impact, tone, affected sectors and mentioned stocks; ⚡ flash bar for high-impact news; recurring market-moving events |
| **Ask · Company Enquiry** | Type any company to get one dossier covering: a plain-English summary; an **investor call** (ACCUMULATE / HOLD / WAIT / EXIT) and a trader signal; entry zone, stop-loss, targets and exit triggers; past track record vs the index; present valuation and quality; **3-year bear/base/bull scenarios** with implied prices; growth drivers and risks; company events (estimated results date, plus dividends, splits and earnings dates through the bridge); company news; and an **AI analyst** you can ask free-form questions (through the bridge with your Anthropic API key) |
| **Large · Mid · Small cap** | Splits stocks into large, mid and small caps using the SEBI/AMFI rule (by live market-cap rank once real data is loaded, otherwise by index membership). Each pool gets: a plain-English summary; **best stocks to ENTER** (entry zone, stop, targets) and **stocks to EXIT** (with reasons); past returns vs NIFTY; present breadth, valuation and quality; future prospects (median growth, upside to fair value, base-case 3-year return); a side-by-side comparison flagging which pool screens best now; **government decisions affecting stocks in the pool** (and live headlines); and a top-25 leaderboard. Rankings can be filtered by pool |
| **Intraday** | 1/3/5/15/30-minute candles (from your broker or Yahoo via the bridge), VWAP with ±1σ/±2σ bands, opening-range high/low, classic pivots and CPR, market profile (POC and value area), intraday RSI, relative volume by time of day, live time-and-sales via the bridge WebSocket, and intraday backtests (opening-range breakout, VWAP ±2σ mean reversion) with MIS charges and a 15:15 square-off |
| **Institutional Desk (FII/DII)** | A pre-trade committee for any order size and fund AUM: SEBI-style checks (10% single-stock limit, sector cap, liquidity, impact, valuation, earnings quality, signal, beta) with an APPROVE / LIMITS / REJECT verdict; liquidity (ADV, % of ADV, days to build, square-root market impact, Roll and Corwin-Schultz spreads, Amihud); Almgren-Chriss vs TWAP execution and intraday VWAP slicing; reverse DCF (growth priced in); forensic earnings quality; Barra-style multi-factor risk model (6 styles + sectors) with factor vs specific risk, ex-ante tracking error and active share; Black-Litterman NIFTY 50 allocation with a 10% cap; 8 stress scenarios; Brinson attribution; FII/DII ownership-flow tracker |
| **Quant · Analytics & Forecast** | For one stock: return distribution (skew, kurtosis, Jarque-Bera); autocorrelation and Ljung-Box; Hurst exponent; ADF stationarity tests; GARCH(1,1) volatility; VaR/CVaR; alpha/beta regression; calendar effects; worst drawdowns. **16 forecasting models**: naive drift, regression channel, AR(5), Holt, Kalman filter, Ornstein-Uhlenbeck, time-series momentum, seasonality, bootstrap-GARCH Monte Carlo, 2-state hidden Markov regimes, logistic regression, linear regression, random forest, MLP neural network, k-NN analogs, beta factor model. Each is **walk-forward tested** (hit rate, skill vs naive, Brier score) and combined into a skill-weighted ensemble shown on a probability gauge, vote donut and Monte Carlo fan chart |
| **Quant · Portfolio & Stat-Arb** | Efficient frontier (4,000 portfolios), max-Sharpe / min-variance / risk-parity / equal-weight portfolios with weight donuts, correlation heatmap, principal-component analysis, Kelly sizing; pairs trading (hedge ratio, cointegration ADF, half-life, z-score signals, backtest, sector pair scanner); factor information coefficients and momentum quintiles; multi-factor composite ranking; factor rotation backtests (momentum, low volatility, 52-week high, reversal) |
| **P&L Report** | Fetch trades and holdings from your broker (or import the tradebook CSV from Zerodha Console, Dhan, Groww or Angel One, or use paper trades). Matches buys to sells first-in-first-out to compute realised P&L with estimated charges, unrealised P&L, win rate, profit factor, expectancy, drawdown and STCG/LTCG/intraday split with a tax estimate. Charts: donuts for winners vs losers, tax heads, profit by stock and sector allocation; cumulative and monthly P&L; top winners and losers; trade-return distribution; P&L by weekday and by holding period |
| **Rankings** | Every stock in every index (including about 40 small caps), **best first**, by DQ Score (Trend · Momentum · Valuation · Quality · Growth · Risk; adjustable weights); BUY ZONE / HOLD / WAIT / EXIT signals; filters; watchlist; CSV export |
| **Screener** | Screener.in-style query language (`ROE > 15 AND Sales growth 3Years > 10 AND Debt to equity < 0.5`), 45+ fields, 12 preset screens, saved screens, custom columns |
| **Company** | Candlestick chart (SMA, EMA, Bollinger, Supertrend, RSI, MACD, volume); get-in / get-out decision panel with a checklist and an ATR-based trade plan; quarterly results, P&L, balance sheet, cash flow, ratios, shareholding, peers and market share, documents; **intrinsic value** (DCF, Graham number and formula, sector P/E, justified P/B); text report |
| **Strategy Lab** | 9 strategies backtested with Indian costs (STT, exchange fees, SEBI fees, stamp duty, GST); stop-loss and target exits; equity and drawdown charts; trade list; parameter-grid optimiser; batch run across a whole index; **Python strategies** written in the browser (Pyodide, numpy, pandas) and run on the same engine; **walk-forward optimisation** with out-of-sample equity and walk-forward efficiency; **Monte Carlo** resampling of trade sequences (return and drawdown percentiles, probability of loss); a **strategy portfolio** combining several strategies, with their return correlations |
| **F&O · Options** | Option chain (live through the bridge, otherwise theoretical Black-Scholes) with OI, ΔOI, IV, Δ, PCR and max pain; 15 strategy presets (straddles, **strangles**, iron condor and butterfly, spreads, ratio spread, jade lizard, covered call, protective put…); payoff at expiry and today; Greeks; breakevens; single-option and implied-volatility calculator |
| **F&O Analytics** | Implied-volatility rank and percentile (India VIX for NIFTY, ATM straddle-implied vol from NSE F&O bhavcopies for others); volatility cone; IV smile and term structure; OI build-up classification for all stock futures (long/short build-up, short covering, long unwinding); participant-wise OI (FII/DII/Pro/Client); futures rollover; **option-strategy backtester** (short/long strangle and straddle, iron condor, credit spreads) with stop-loss, charges, equity curve and P&L distribution |
| **Funds · ETFs · IPOs · Bonds** | Mutual-fund search across all AMFI schemes (mfapi.in), up to 6 funds compared: 1/3/5-year CAGR, volatility, Sharpe, Sortino, max drawdown, beta and alpha vs NIFTY, rolling 1-year returns (median, worst, % negative), calendar-year returns, SIP XIRR; portfolio overlap between two funds; ETF quotes; NSE IPO tracker (current and upcoming); bond/G-sec calculator (price, YTM, Macaulay and modified duration, convexity, price–yield curve); Sovereign Gold Bond return calculator |
| **Portfolio** | Holdings with P&L, weights, signals and concentration warnings; sync from broker; SIP calculator with annual step-up; XIRR; capital-gains tax estimate |
| **Alerts & Brief** | 14 alert types: price above/below, day % move, 200-DMA cross, RSI levels, signal change, opportunity flag, holding stop-loss hit, volume spike, high-impact news, delivery %. One click creates stop-loss/EXIT alerts for holdings and BUY/opportunity alerts for the watchlist. Delivered in-page, by browser notification, and via the bridge to **Telegram, email or WhatsApp**. Rules sync to the bridge so price alerts keep running with the page closed, and a **morning brief** is sent on weekdays at 08:45 IST |
| **Algo & Brokers** | Connect Zerodha, Dhan, Groww, Angel One or Fyers (or Yahoo for delayed data); rules engine; paper and live trading; auto-trading loop; risk limits and a kill switch; order ticket; positions and order blotter; activity log |
| **Data & Settings** | Import price CSVs (NSE / Yahoo format) and fundamentals CSVs; add symbols; settings for charges, tax, lot sizes and valuation |

## Data: demo vs live

The site works offline using **clearly labelled simulated data** (yellow `SIM` badges). It never shows invented news. For real data, use one of these:

1. **Bridge (recommended).** Real-time quotes, history, option chains and orders through your broker. Fundamentals, world markets and news come from yfinance and public RSS feeds.
2. **CSV import.** Load price history and quarterly fundamentals yourself (Data & Settings).

### Running the bridge

```bash
cd bridge
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt                        # then also install your broker's SDK (see file)
cp config.example.json config.json                     # add your API keys; keep "allow_live_orders": false at first
                                                       # optional: "anthropic_api_key" enables the AI analyst
python bridge.py                                       # → http://127.0.0.1:8765
```

Next, open the site and go to **Algo & Brokers**. Pick your broker, keep the URL as `http://127.0.0.1:8765`, and click **Connect**. Then:
- Click **Load live history** → **Load fundamentals**, and tick **Live quotes**.
- For a Zerodha or Fyers daily login, open `http://127.0.0.1:8765/login/zerodha` (or `/login/fyers`) once a day.
- Start with `"broker": "yahoo"`. It needs no keys and gives delayed data, which is a good way to check that everything works.
- **NSE official end-of-day data:** choose *NSE official EOD* as the source and click **Sync NSE files** (Data & Settings). The bridge downloads ~3 years of NSE bhavcopies (prices + delivery %) and 60 days of F&O bhavcopies into `bridge/cache/`, adjusts for splits/bonuses, and powers: delivery-% analysis, FII/DII daily flows, bulk/block deals, insider (SEBI PIT) trades, promoter pledges, OI build-up and rollover. Requests are throttled and cached; this is for personal use, so check NSE's terms of use.

**Safety:**
- API secrets stay in `config.json` on your machine. It is git-ignored.
- Live orders are blocked until you set `"allow_live_orders": true`.
- The page asks you to confirm before every live order and before starting live auto-trading.
- Risk limits and a kill switch apply to both paper and live trading.

**Broker adapters:** these follow each SDK's published interface but have not been tested against live accounts. Verify them with small orders first. Zerodha and Fyers have the most complete coverage, including option chains.

## Methodology

- **DQ Score** is a weighted average of six components:
  - Trend: price vs the 50- and 200-day moving averages
  - Momentum: RSI and MACD
  - Valuation: upside to the median intrinsic value, plus P/E vs the sector median
  - Quality: ROE, debt/equity and margins
  - Growth: 3-year sales and profit CAGR, plus latest-quarter YoY
  - Risk: volatility and drawdown
- **Opportunity** means all of the following:
  - quality ≥ 60, growth ≥ 50, and profitable
  - at least 15% below the 52-week high, or down 8% or more over 3 months
  - trading below intrinsic value

These are mechanical screens on the data loaded. **They are not investment advice.** Charge, tax and lot-size defaults reflect rules as of 2025–26 and can be edited. Index constituent lists change at NSE/BSE reviews.

## Files

- `index.html`: the whole terminal (no build step, no dependencies)
- `bridge/bridge.py`: FastAPI bridge (REST contract documented in the Algo tab)
- `bridge/config.example.json`, `bridge/requirements.txt`

# DalalQuant — Indian markets terminal

📘 **Complete manual (PDF):** [docs/dalalquant_manual.pdf](docs/dalalquant_manual.pdf) — documentation, tutorials and quizzes in one file.

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.24334668.svg)](https://doi.org/10.5281/zenodo.24334668)

**Live site:** https://gokaran-shukla.github.io/dalalquant

DalalQuant is a single-page terminal covering investing, trading and algo trading on NSE/BSE. It also includes US stocks, world indices, commodities, FX, bonds and crypto. Everything runs in your browser. The small optional **bridge** (`bridge/bridge.py`) adds real-time data, news and order routing through your own broker account.

## What's inside

The sections below are grouped into eight tabs: **Markets, Charts, F&O, Quant, Portfolio, Screener, Backtest and Setup**. Each tab has its own row of section buttons. On phones a bottom bar gives Markets, Charts, F&O, Portfolio and a **More** sheet listing every section.

**Power-user features:** press **Ctrl/⌘ K** for a command palette that jumps to any section, stock or action, with your recently viewed stocks at the top. Press **?** for all keyboard shortcuts: `/` searches, `g m` goes to Markets, `g o` to the option chain, `g p` to Portfolio, and `[` / `]` move between sections in a tab. Every chart has a **Download PNG** button.

**Chart intervals:** the Intraday and Company charts share one interval bar: **1s, 5s, 10s, 15s, 30s · 1m, 2m, 3m, 5m, 10m, 15m, 30m, 45m · 1h, 2h, 4h · 1D, 1W, 1M**. With the bridge connected, minute and hour candles come from your broker (unusual sizes such as 2m, 10m, 45m, 2h and 4h are built from 1/5/15/60-minute data). Second candles are built live from ticks. Without the bridge, all intervals use simulated data. 1W and 1M aggregate the daily chart.

**Personal touches:** the app opens on **My Dashboard**, where you can add, remove and drag widgets (indices, watchlist, movers, heatmap, portfolio, breadth, opportunities, headlines, alerts). It has a **light/dark theme** switch, a **bell** that shows unread alerts and live alert notifications, a **+ Alert** button on every company page, and **Compare Stocks** for up to four stocks side by side (relative performance chart plus valuation, quality and signal table, with the best value in each row highlighted).

| Section | Highlights |
|---|---|
| **India Markets** | Daily written briefing; all major NSE/BSE indices with sparklines; derived India VIX; breadth; sector heatmap; top gainers and losers; **Opportunities** (strong businesses well below their highs), which also pop up each time you open the terminal |
| **Market Mood · Sectors · Policy** | A fear–greed gauge built from 8–9 indicators (breadth, % of stocks above the 50/200-day averages, index momentum, VIX, 52-week highs vs lows, PCR, global cues, news tone), each explained in plain words; which sectors are **flourishing** and which are **under pressure**; a sector rotation map (leading / weakening / lagging / improving) and sector scoreboard; a **government policy tracker** (Budget 2026-27 capex, railways, defence, Semiconductor Mission 2.0, the 7-sector manufacturing push, PLI, energy storage, AI data centres) with named beneficiary stocks and whether the market is currently rewarding each theme; live policy headlines |
| **World · US · Commodities** | US, Europe, Asia-Pacific and Middle East indices; gold, silver, crude, gas and metals; INR crosses and DXY; US and India 10-year yields; crypto; rule-based **global cues for India** with the sectors each move affects; US stock rankings and sector heatmap |
| **News & Events** | Live RSS headlines (through the bridge), auto-tagged by topic (Fed, RBI, crude, tariffs, geopolitics, earnings, FII flows…) with impact, tone, affected sectors and mentioned stocks; ⚡ flash bar for high-impact news; recurring market-moving events |
| **Ask · Company Enquiry** | Type any company to get one dossier covering: a plain-English summary; an **investor call** (ACCUMULATE / HOLD / WAIT / EXIT) and a trader signal; entry zone, stop-loss, targets and exit triggers; past track record vs the index; present valuation and quality; **3-year bear/base/bull scenarios** with implied prices; growth drivers and risks; company events (estimated results date, plus dividends, splits and earnings dates through the bridge); company news; and an **AI analyst** you can ask free-form questions (through the bridge with your Anthropic API key) |
| **Large · Mid · Small cap** | Splits stocks into large, mid and small caps using the SEBI/AMFI rule (by live market-cap rank once real data is loaded, otherwise by index membership). Each pool gets: a plain-English summary; **best stocks to ENTER** (entry zone, stop, targets) and **stocks to EXIT** (with reasons); past returns vs NIFTY; present breadth, valuation and quality; future prospects (median growth, upside to fair value, base-case 3-year return); a side-by-side comparison flagging which pool screens best now; **government decisions affecting stocks in the pool** (and live headlines); and a top-25 leaderboard. Rankings can be filtered by pool |
| **Live Agent · NSE/BSE stream** | Push-based real-time ticks for NSE **and** BSE through the bridge's `/ws/live` socket, fed by one broker market-data WebSocket (Fyers, Zerodha KiteTicker or Angel One SmartAPI; other brokers fall back to polling). Live table with bid/ask, volume, OI and the **NSE↔BSE price gap** for dual-listed stocks. A rule-based **market agent** watches every tick for opening-range breaks, VWAP ±2σ stretches, fast moves, 1-minute volume surges, new day highs/lows, NSE–BSE gaps and a frozen feed, and can keep watching (and alert by Telegram/email) with the page closed. **Ask the agent** questions in plain English: Claude reads the live stream through tools (read-only, no orders) |
| **Intraday** | 1/3/5/15/30-minute candles (from your broker or Yahoo via the bridge), VWAP with ±1σ/±2σ bands, opening-range high/low, classic pivots and CPR, market profile (POC and value area), intraday RSI, relative volume by time of day, live time-and-sales via the bridge WebSocket, and intraday backtests (opening-range breakout, VWAP ±2σ mean reversion) with MIS charges and a 15:15 square-off |
| **Institutional Desk (FII/DII)** | A pre-trade committee for any order size and fund AUM: SEBI-style checks (10% single-stock limit, sector cap, liquidity, impact, valuation, earnings quality, signal, beta) with an APPROVE / LIMITS / REJECT verdict; liquidity (ADV, % of ADV, days to build, square-root market impact, Roll and Corwin-Schultz spreads, Amihud); Almgren-Chriss vs TWAP execution and intraday VWAP slicing; reverse DCF (growth priced in); forensic earnings quality; Barra-style multi-factor risk model (6 styles + sectors) with factor vs specific risk, ex-ante tracking error and active share; Black-Litterman NIFTY 50 allocation with a 10% cap; 8 stress scenarios; Brinson attribution; FII/DII ownership-flow tracker |
| **Event-Driven Edge** | **NIFTY 50 inclusion/exclusion predictor** applying NSE's rule (6-month average free-float market cap ≥ 1.5× the smallest constituent; reviews in March and September), with estimated weights, passive buying/selling and days of ADV. **Post-earnings drift** event study (average cumulative abnormal returns after large results-season surprises, with fresh candidates). **Special situations** from NSE announcements (buybacks, open offers, delistings, demergers, mergers, bonuses, splits) and a buyback-arbitrage calculator; the **F&O ban list**; and a **guidance tracker** (manual or AI-extracted from uploaded documents) scoring management credibility |
| **Quant · Analytics & Forecast** | For one stock: return distribution (skew, kurtosis, Jarque-Bera); autocorrelation and Ljung-Box; Hurst exponent; ADF stationarity tests; GARCH(1,1) volatility; VaR/CVaR; alpha/beta regression; calendar effects; worst drawdowns. **16 forecasting models**: naive drift, regression channel, AR(5), Holt, Kalman filter, Ornstein-Uhlenbeck, time-series momentum, seasonality, bootstrap-GARCH Monte Carlo, 2-state hidden Markov regimes, logistic regression, linear regression, random forest, MLP neural network, k-NN analogs, beta factor model. Each is **walk-forward tested** (hit rate, skill vs naive, Brier score) and combined into a skill-weighted ensemble shown on a probability gauge, vote donut and Monte Carlo fan chart |
| **Quant · Portfolio & Stat-Arb** | Efficient frontier (4,000 portfolios), max-Sharpe / min-variance / risk-parity / equal-weight portfolios with weight donuts, correlation heatmap, principal-component analysis, Kelly sizing; pairs trading (hedge ratio, cointegration ADF, half-life, z-score signals, backtest, sector pair scanner); factor information coefficients and momentum quintiles; multi-factor composite ranking; factor rotation backtests (momentum, low volatility, 52-week high, reversal) |
| **P&L Report** | Fetch trades and holdings from your broker (or import the tradebook CSV from Zerodha Console, Dhan, Groww or Angel One, or use paper trades). Matches buys to sells first-in-first-out to compute realised P&L with estimated charges, unrealised P&L, win rate, profit factor, expectancy, drawdown and STCG/LTCG/intraday split with a tax estimate. Charts: donuts for winners vs losers, tax heads, profit by stock and sector allocation; cumulative and monthly P&L; top winners and losers; trade-return distribution; P&L by weekday and by holding period |
| **AI Analyst · Documents** | An AI-written pre-market brief built from the terminal's live state (mood, sectors, global cues, FII/DII flows, opportunities, headlines), with a rule-based fallback and one-click send to Telegram/email. Upload annual reports, earnings-call transcripts or DRHPs as PDF (read in the browser with pdf.js) or paste text; questions are answered from the best-matching passages (BM25 search) with page citations, via the bridge's `/ai` endpoint and your Anthropic API key. Includes preset questions on guidance, risks, capex, segments, debt and related-party items |
| **Alternative Data** | **Mutual-fund flows** from AMC monthly portfolio disclosures (CSV import): most accumulated and distributed stocks, ₹ bought or sold, net buying by sector. **Monthly economy → sectors**: auto sales, GST, power demand, card spends, e-way bills and more (CSV import), with YoY trends and lead-lag correlations against sector returns. **News-sentiment factor** per stock (7-day and 30-day tone, sentiment momentum) built from the live news feed. **Management tone** across uploaded transcripts and reports (net tone, positive/negative/uncertainty word rates) |
| **Execution & Risk** | **Transaction-cost analysis** of real or paper fills: slippage vs VWAP and vs open, charges in bps, ₹ lost to timing, worst stocks. **GTT/OCO brackets**: protect any open position with a stop and target (2×/4× ATR defaults); live mode sends a Zerodha GTT-OCO via the bridge `/gtt`. **Portfolio circuit breakers** on every order: drawdown halt (auto kill switch, exits still allowed), correlation-spike alert, and a results-blackout that blocks new buys within ±N days of results (NSE board-meeting dates, your own dates, or an estimate) |
| **App · Sync · Share** | **Installable app (PWA)**: install on Android, iPhone, Windows or Mac with an icon and full-screen window; the app shell works offline. **System notifications** for price, opportunity and risk alerts (click opens the stock). **Multi-device sync** through your own bridge (`GET/PUT /sync`, token-protected, conflict warning) plus JSON backup export and import. **Shared watchlists** by link (`?w=SYM,SYM&n=Name`) and company deep links (`?s=INFY`) |
| **My Radar** | Unlimited named watchlists (colour-coded): live price, 30-day sparkline, 1D/1W/1M/1Y, distance from 52-week high, DQ score and signal per stock, a note per stock, sortable columns, drag to reorder, copy between lists, paste symbols from anywhere, CSV export and share link. **Entry / exit call** column right after each stock, market cap column. **Smart lists**: scans the whole NSE from NSE end-of-day files (bridge `/scan/volatility`, AMFI market caps) for every high-volatility, liquid stock and files them all into *High volatility · Large / Mid / Small caps* lists, largest market cap first. The selected list is the active watchlist used by stars, the dashboard and filters; the symbol search's **+** adds to whichever list you pick |
| **Decision Lab** | Press **Run**: for every stock in a chosen list, nine engines run one after another (DQ multi-factor score, trend, momentum, the 16-model forecast ensemble, ML cross-sectional rank, valuation vs intrinsic value, Hurst regime, risk & liquidity, results-blackout/F&O-ban filters). Their weighted votes become a flashing **ENTER / ENTER IN PARTS / BUY ON DIP / WAIT / EXIT** flag with confidence, stop-loss (2×ATR), target, R:R and position size; the verdict also feeds My Radar's entry/exit column |
| **Symbol Search** | TradingView-style search (press `/` or just start typing anywhere): every NSE equity and ETF, indices, BSE-only, US and global stocks and crypto, with type filters, live price and change, keyboard navigation and a **+** button that adds the stock to your watchlist. Stocks not yet in the terminal are added and their real history and fundamentals load through the bridge (`/symbols/search`, `/symbols/register`) |
| **Rankings** | Every stock in every index (including about 40 small caps), **best first**, by DQ Score (Trend · Momentum · Valuation · Quality · Growth · Risk; adjustable weights); BUY ZONE / HOLD / WAIT / EXIT signals; filters; watchlist; CSV export |
| **Signal Track Record** | Proves (or disproves) the signals. A **point-in-time historical replay** re-scores every stock every 5 trading days using only prices and results that were public then; a **live ledger** logs every stock's signal daily and scores it 1/5/21 days later. Shows hit rate, average and excess return by signal and by score decile, opportunity-flag performance, and a BUY-ZONE equity curve. A **forward paper test** follows the signals from today, and **survivorship-free membership** lets you import historical index constituents (used by the replay and rotation backtests) |
| **Screener** | Screener.in-style query language (`ROE > 15 AND Sales growth 3Years > 10 AND Debt to equity < 0.5`), 45+ fields, 12 preset screens, saved screens, custom columns |
| **Company** | Candlestick chart (SMA, EMA, Bollinger, Supertrend, RSI, MACD, volume); get-in / get-out decision panel with a checklist and an ATR-based trade plan; quarterly results, P&L, balance sheet, cash flow, ratios, shareholding, peers and market share, documents; **intrinsic value** (DCF, Graham number and formula, sector P/E, justified P/B); text report |
| **ML Ranking Model** | A cross-sectional **histogram gradient-boosted tree** model (written in JS) trained on a monthly panel of 12 point-in-time features for every Indian stock, predicting relative returns 1 week, 1 month or 3 months ahead. Validated with **purged and embargoed time-series cross-validation**: IC by month, IC information ratio, decile spread and top-decile vs universe. Shows feature importance, per-stock driver attributions (Saabas), and current top/bottom rankings. **Meta-labelling**: a second model estimates which primary signals to take and sizes them by conviction |
| **Strategy Lab** | 9 strategies backtested with Indian costs (STT, exchange fees, SEBI fees, stamp duty, GST); stop-loss and target exits; equity and drawdown charts; trade list; parameter-grid optimiser; batch run across a whole index; **Python strategies** written in the browser (Pyodide, numpy, pandas) and run on the same engine; **walk-forward optimisation** with out-of-sample equity and walk-forward efficiency; **Monte Carlo** resampling of trade sequences (return and drawdown percentiles, probability of loss); a **strategy portfolio** combining several strategies, with their return correlations |
| **F&O · Options** | Option chain (live through the bridge, otherwise theoretical Black-Scholes) with OI, ΔOI, IV, Δ, PCR and max pain; 15 strategy presets (straddles, **strangles**, iron condor and butterfly, spreads, ratio spread, jade lizard, covered call, protective put…); payoff at expiry and today; Greeks; breakevens; single-option and implied-volatility calculator |
| **F&O Analytics** | Implied-volatility rank and percentile (India VIX for NIFTY, ATM straddle-implied vol from NSE F&O bhavcopies for others); volatility cone; IV smile and term structure; OI build-up classification for all stock futures (long/short build-up, short covering, long unwinding); participant-wise OI (FII/DII/Pro/Client); futures rollover; **option-strategy backtester** (short/long strangle and straddle, iron condor, credit spreads) with stop-loss, charges, equity curve and P&L distribution |
| **Funds · ETFs · IPOs · Bonds** | Mutual-fund search across all AMFI schemes (mfapi.in), up to 6 funds compared: 1/3/5-year CAGR, volatility, Sharpe, Sortino, max drawdown, beta and alpha vs NIFTY, rolling 1-year returns (median, worst, % negative), calendar-year returns, SIP XIRR; portfolio overlap between two funds; ETF quotes; NSE IPO tracker (current and upcoming); bond/G-sec calculator (price, YTM, Macaulay and modified duration, convexity, price–yield curve); Sovereign Gold Bond return calculator |
| **Portfolio** | Holdings with P&L, weights, signals and concentration warnings; sync from broker; SIP calculator with annual step-up; XIRR; capital-gains tax estimate |
| **Journal · Tax · Goals** | **Trade journal** (setup, emotion, plan followed, mistakes, notes; import closed trades from the P&L Report) with P&L by setup, emotion and mistake, plan-followed vs broken, and R-multiple distribution; **tax-loss harvesting** for the current Indian FY (realised STCG/LTCG, loss candidates with tax saved under Indian set-off rules, unused LTCG exemption for gain harvesting, days to 31 March); **rebalancing** (large/mid/small/debt/gold/cash vs targets, drift bands, buy/sell amounts); **goal planner** (inflation-adjusted targets, step-up SIP, Monte Carlo success probability, required SIP) |
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

### Real-time stream and the market agent

The bridge holds one streaming connection to your broker (`bridge/live_feed.py`) and fans ticks out to every open DalalQuant page and to the agent (`bridge/agent.py`).

- Set `"live": {"feed": "fyers"}` (or `zerodha` / `angel`) in `config.json`. If it is not set, your `broker` is used; brokers without a streaming API are polled. Use `"feed": "sim"` to test after hours: ticks are simulated and flagged **SIM** everywhere.
- Symbols: `RELIANCE` is NSE, `BSE:RELIANCE` is BSE, and index names such as `NIFTY 50` or `SENSEX` work as usual.
- After the daily broker login (`/login/fyers`, `/login/zerodha`) the stream reconnects by itself. You can also call `POST /live/restart`.
- Open **Live Agent** and click **Start stream**. To keep the agent watching with the page closed, click **Agent: watch with page closed**, or set `"agent": {"autostart": true}` to stream your config `watchlist` from start-up.
- Ask the agent questions with `anthropic_api_key` set. It answers from the live data through tools, and it cannot place orders.

Endpoints: `WS /ws/live` (`{"op":"sub"|"unsub","symbols":[…]}`), `GET /live/status`, `GET /live/snapshot`, `GET /live/bars`, `POST /live/restart`, `POST /agent/watch`, `GET /agent/events`, `GET|POST /agent/params`, `POST /agent/ask`.

Direct exchange feeds (NSE NNF/TBT, BSE EOBI) are only available to exchange members and licensed vendors, so retail real-time NSE/BSE data comes through a broker API or a licensed vendor. Check your broker's API terms for data use.

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

## Running the bridge in the cloud (use the terminal live from your phone)

`deploy/` contains a Docker Compose setup with Caddy (automatic HTTPS):

```bash
# on a small Linux VM with Docker, after pointing bridge.example.com at it
git clone https://github.com/Gokaran-Shukla/dalalquant && cd dalalquant/deploy
cp ../bridge/config.example.json config.json   # set a long random "bridge_token", your broker keys,
                                               # "allowed_origins": ["https://gokaran-shukla.github.io"]
DOMAIN=bridge.example.com docker compose up -d
```

Then in **Algo & Brokers** set the bridge URL to `https://bridge.example.com` and paste the token.

**Security:**
- Never expose the bridge without a `bridge_token`.
- Keep `allow_live_orders` off until you have tested.
- Some brokers restrict API use from servers or require a static IP; check your broker's API terms.

## Development

When you add a new `js/NN-*.js` file, add its `<script>` tag before `js/99-boot.js` in `index.html`; `sw.js` is network-first, so new files work online immediately (add them to its `SHELL` list for offline use).


- The terminal is plain HTML/CSS/JS with no build step: `index.html`, `css/dalalquant.css` and `js/NN-*.js`. The modules are loaded in order and share one global namespace.
- Tests:
  - `npm install && npm test` loads the real page in jsdom. It checks indicators, OLS, Black-Scholes parity and implied volatility, XIRR, bond maths, FIFO P&L, the screener parser, backtest bookkeeping, GARCH and the forecast engine.
  - `python -m pytest tests` checks the NSE file parsers, split adjustment, OI build-up and participant OI.
- GitHub Actions (`.github/workflows/ci.yml`) runs both test suites on every push.

## Files

- `index.html`, `css/`, `js/`: the terminal (38 ordered modules, no build step)
- `bridge/nse_data.py`: NSE bhavcopy, F&O, FII/DII, deals, insider and pledge loaders; `bridge/notify.py`: Telegram/email/WhatsApp and the alert/brief scheduler
- `tests/`: JS (jsdom) and Python unit tests · `deploy/`: Docker + Caddy cloud bridge · `.github/workflows/ci.yml`: CI
- `bridge/bridge.py`: FastAPI bridge (REST contract documented in the Algo tab)
- `bridge/live_feed.py`: real-time NSE/BSE feed hub (Fyers, Zerodha, Angel One streams; polling and simulated fallbacks); `bridge/agent.py`: market agent (detectors + Claude tool-use Q&A)
- `bridge/config.example.json`, `bridge/requirements.txt`

## Citing DalalQuant

If DalalQuant helps your work, please cite the software:

> G. Shukla, *DalalQuant: a browser-based terminal for Indian markets*, version 1.0.0 (2026). Zenodo. https://doi.org/10.5281/zenodo.24334668

```bibtex
@software{shukla_dalalquant_2026,
  author    = {Shukla, Gokaran},
  title     = {DalalQuant: a browser-based terminal for Indian markets},
  version   = {1.0.0},
  year      = {2026},
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.24334668},
  url       = {https://github.com/Gokaran-Shukla/dalalquant}
}
```

GitHub's **"Cite this repository"** button (from `CITATION.cff`) gives the same reference in APA and BibTeX.

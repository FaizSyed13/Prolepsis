# Notes for AI coding assistants (OpenCode, Claude Code, etc.)

Read this before changing anything. It explains what Prolepsis is, how it fits together, how to
test changes honestly, and which ideas were already tested and rejected (so you don't repeat them).

## The owner

- Not a programmer. Explain things in plain language, avoid jargon, keep answers short.
- Prefers free tools and services. Ask before adding anything that costs money.
- Ask before big changes (redesigns, new pages, new data sources, new dependencies).
- The owner edits the README's disclaimer wording themselves ("coin-flip" line). Don't change it.
- The project is **all rights reserved** (see `LICENSE`). Don't change the license.

## What Prolepsis is

Honest 5-day stock forecasts for 40 large US stocks (list in `stockpred/config.py`), plus a daily
market recap, news and a public track record. It shows, for each stock:

- **P(up)**: calibrated chance the price is higher in 5 trading days (gradient boosting + isotonic calibration).
- **80% price range**: quantile regression (10th/90th percentile of the 5-day return) widened by a
  conformal margin sized to each stock's 21-day volatility, so it holds ~80% for calm and jumpy stocks alike.
- **News adjustment**: FinBERT scores headlines (last 3 days) and nudges P(up) / widens ranges.
- **Advice**: short-term and long-term Buy/Hold/Sell rules (`stockpred/advice.py`). Reading only.
- **Import my trades** (top of Home, above Next week at a glance): visitor picks or pastes a broker trade-history CSV,
  or clicks "Try an example" (made-up trades built in app.js `demoTrades()`, priced around today's prices; real forecasts).
  `web/trades.js` (pure, also runs in Node) finds the header row, guesses columns (symbol / buy-sell / shares / price; the
  visitor can change them) and works out shares owned = bought - sold, average price paid = buy cost / shares bought.
  Shows each owned stock's forecast, then the total 80% range: each stock's range combined with the past-year daily-return
  correlation (`stockpred/portfolio.py`, `state.corr`), normal approx. Tested on 70,000 random 1-40 stock portfolios
  2023-2026 (unseen): 80.0% inside (1 stock 79%, 40 stocks 82%); crash weeks ~46%. The old type-in "My money" calculator
  was removed (owner's choice). Runs only in the browser; nothing is uploaded or saved. No Alpha Vantage / API keys.

Honest current numbers (walk-forward, newest 30% of history never used for calibration):
up/down accuracy ~54%, which equals always guessing the more common outcome (no real direction skill);
range coverage ~79.75% vs an 80% target. The site says this openly. Keep it that way.

## How it runs

| Piece | File(s) |
|---|---|
| Prices (Yahoo, cached in `data/prices.pkl`) | `stockpred/data.py` |
| Features (only data up to the close of day t) | `stockpred/features.py` |
| Models | `stockpred/models.py` |
| Walk-forward testing | `stockpred/backtest.py` |
| Calibration, ranges, latest forecast | `stockpred/probability.py` |
| News fetch + FinBERT (ONNX, no torch) | `stockpred/live_news.py`, `stockpred/sentiment.py`, `stockpred/auto_reason.py` |
| Market tiles, futures, market news | `stockpred/market.py` |
| Company facts, analyst view, earnings dates | `stockpred/fundamentals.py` |
| Forecast log + track record | `stockpred/reasoning.py` |
| Puts it all together, refresh loop | `stockpred/service.py` |
| Local website (http://127.0.0.1:8050) | `app.py` + `web/` |
| Public static site (GitHub Pages) | `build_site.py` -> `_site/` |
| Research CLI | `run.py backtest`, `run.py backtest --sanity`, `run.py predict` |

- **Public site:** https://faizsyed13.github.io/Prolepsis/ built by
  `.github/workflows/daily.yml` (weekdays 23:00 and 10:30 UTC, on push, or manually). The job also
  commits `reports/forecast_log.csv` ("Daily forecast log [skip ci]"), so **run `git pull` before committing**.
- **Local app:** `Start Stock Forecast.bat` / `(Mac).command` / `(Linux).sh` set up a private Python with
  `uv` (pinned) on first start. The app shows the public `state.json` instantly while it builds its own.
  On a PC the forecast log goes to `reports/forecast_log_pc.csv` (gitignored); only GitHub Actions writes the official log.
- **Releases:** push a tag `vX.Y.Z` and `.github/workflows/release.yml` builds the zip with
  `.github/release-notes.md`. Only make a release when the owner asks.
- **Website:** one page with menu pages (Home with Import my trades at the top, Market recap, Forecasts, News, Track record,
  How to read), hash routes `#/home` (data-page "today"), `#/money` and `#/import` (jump to Import my trades), `#/recap` etc. Living sky background (`web/sky.js`: visitor's time of day from their clock = dawn/day/dusk/night; optional "Show my weather" = browser location rounded to ~10 km -> Open-Meteo, free, no key, cached 30 min; clear/cloudy/rain/storm/snow; test with `?sky=night-rain`; still when reduced motion). Dark "Luxe" palette: gold + rose-gold accents on plum-black, emerald/ruby/sapphire (owner's choice 2026-11-21; earlier Catppuccin Mocha, light Beat & Drop rejected), Newsreader (headings) + IBM Plex Sans (text) fonts like Beat & Drop, rounded corners, a cat cursor buddy and hearts.

Setup for development: `python -m venv .venv` then `.venv\Scripts\python -m pip install -r requirements.txt`.

## Rules for changing the model

1. **No peeking at the future.** Features at date t may only use data up to the close of t.
   Labels (`fwd_ret`, `up`, `target`) are never features. Never shuffle time series.
2. **Test with walk-forward** (`stockpred/backtest.py`) on the full history (2010+) and all 40 stocks,
   comparing against the current model on the **same rows**.
3. **Keep a never-touched final check:** calibration is fitted on the oldest 70% of out-of-sample
   history and graded on the newest 30%.
4. **Count it as better only if** it beats the current model on the honest test, holds in most
   individual years, and survives a shuffled-label sanity check. Tiny gains within noise don't count.
5. Report results plainly, including failures. Don't present lucky short tests (e.g. 50 days) as wins.
6. Changing the stock list invalidates `data/oos_gboost_h5.pkl` (handled automatically).

## Already tested and rejected (don't redo unless the owner asks)

| Idea | Result |
|---|---|
| Analyst ratings, target changes, earnings surprise as model features | No gain (AUC 0.514 -> 0.512), worse after 2022 |
| Training on 99 stocks instead of 40 | No gain in what the page shows, much slower |
| Longer forecast horizon | Owner said no |
| Market-wide features (VIX, yields, curve, CPI, Nasdaq) | Worse accuracy, Sharpe and ranges |
| Nasdaq-only features | Worse |
| Other model types (logistic, ExtraTrees, averages, stacking, tuned gboost), 3-class labels, abstain rules | No model beat current gboost |
| Next-day ensemble (LightGBM + RF + Ridge, simple/weighted/stacked) | Didn't beat "tomorrow = today", coin-flip direction |
| Simple next-day up/down classifier (RSI/MA features) | Same family as above, skipped |
| Extra volatility features for ranges (short-term, high-low, downside, market vol) | No narrower ranges (quantile models already adapt) |
| TA-Lib indicators, OpenBB, insider trades | Owner said no |
| FINRA short data (daily short-sale volume ratio, short interest days-to-cover / change, ranks) | Tested 2020-2026 (data starts 2018): P(up) AUC 0.516 -> 0.512 (better 1/7 yrs), top-5 Sharpe 0.75 -> 0.53, ranges same |
| Industry / sector ETF features (XLK IGV SMH VOX XLY XLF XLV XLP XLE XLI: sector return, sector vs SPY, stock vs sector at 5/21/63/126 days) | Tested 2014-2026, 40 stocks: P(up) AUC 0.5128 -> 0.5130, calibrated accuracy 54.1% = naive 54.2% both; beat-SPY top10-bottom10 spread +0.229 -> +0.191%/wk (worse 9/13 yrs), t 2.18 -> 1.82 |
| Stress-aware range margins for crash weeks (market vol tercile, 5d vol jump, falling market) | Tested 2017-2026: coverage 78.6-78.8% vs base, bad weeks 4.2-4.6%, no gain; crashes not foreseeable from prior market stress |
| Deep learning: Chronos-Bolt-small (Amazon's pretrained time-series model, zero-shot on 512 daily closes) and 50/50 average with gboost | Tested 2020-2026, 40 stocks, every 5th day, same calibration: P(up) AUC 0.517 (gboost) vs 0.502 (Chronos) vs 0.510 (avg); 2025+ (after Chronos release, no leakage) 0.557 vs 0.502 vs 0.520; Chronos worse in 6/7 years; calibrated acc = naive for all; range coverage 79.2 / 78.6 / 78.6%, widths about equal. Would also add PyTorch (~1 GB installed). Not adopted |
| Many-lag past returns (Ghosh/Neufeld/Sahoo 2021 style: cumulative return over 2..19 days and 20..240 days step 20, 29 extra inputs) | Tested 2014-2026, 40 stocks, same rows, shuffled control: P(up) AUC 0.5128 -> 0.5125 (shuffled 0.5014), calibrated acc 54.2% = naive; up top-5 Sharpe 1.22 -> 1.09; beat-SPY AUC 0.5088 -> 0.5064, top10-bottom10 spread +0.229 -> +0.171%/wk (positive yrs 11/13 -> 8/13); 80% range coverage 79.75 -> 79.57%, width 8.98 -> 8.94%, interval score identical. Not adopted |
| Calendar effects (weekday, month, trading days to/from month end, turn-of-month window, holiday within a week) and pairs (partner = most correlated stock over the previous year: 5/21-day return gap, 63-day spread z-score, ranks) | Tested 2011-2026, 40 stocks, same rows, shuffled control (2026-11-22): P(up) AUC 0.5119 base, 0.5080 calendar, 0.5127 pairs, 0.5070 both; calibrated acc 54.0% = naive for all. Beat-SPY top10-bottom10 spread 0.194 base, 0.264 calendar (t 2.50), 0.180 pairs, 0.241 both, shuffled -0.104. The calendar gain showed up on only 1 of 5 weekly start days (paired t 1.28 there, -0.38 to 0.85 on the others), so it's noise. Not adopted |
| Research "anomaly" features (2026-11-23): lottery/MAX (Bali-Cakici-Whitelaw 2011: max and min daily return over 21 days), risk (Ang et al. 2006 idiosyncratic vol vs SPY, Frazzini-Pedersen 2014 1-year beta), same-month seasonality (Heston-Sadka 2008: stock's average return in this calendar month in prior years), overnight vs intraday (Lou-Polk-Skouras 2019: 21/63-day sums), each + ranks. Momentum, short-term reversal and 52-week-high are already model features | Tested 2012-2026, 40 stocks, same rows: P(up) AUC 0.5158 base, 0.5149 lottery, 0.5151 risk, 0.5152 seasonal, 0.5163 overnight; calibrated acc 53.9% = naive for all. Beat-SPY top10-bottom10 spread 0.175%/wk base, 0.099 lottery, 0.148 risk, 0.240 seasonal (better 7/12 yrs), 0.099 overnight. Seasonal across the 5 weekly start days: paired t 1.20, -0.22, 0.72, 1.68, 0.13 (none significant). Not adopted |
| Minimal redesign of the website | Built, owner rejected it, reverted |
| Showing earnings dates on the page | Owner didn't like it, removed (backend kept) |

Ideas not yet tested: logging options implied volatility daily
(Yahoo has no free history) to test later for ranges.

## Before you finish a change

- Run the app or `build_site.py` and check the page still works (desktop and phone width).
- `git pull` first, then commit with a clear message. Don't commit `.venv`, `data/*.pkl`,
  `data/news.db`, `data/fundamentals.json` or `python/`.
- Never put passwords or tokens in files or chat.

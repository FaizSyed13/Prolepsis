# Stock Predictor (research pipeline)

Predicts whether each of 20 large US stocks will **beat SPY over the next 5 trading days**,
and tests that prediction honestly with a walk-forward backtest.

## Just want to see the forecasts?
Open **https://faizsyed13.github.io/stock-predictor/** in any browser. Nothing to download. Updated every weekday evening.

## Run it on your own Windows PC (no Python install needed)
1. Click the green **Code** button above, then **Download ZIP**.
2. Unzip it anywhere (right-click the file, **Extract All**).
3. Open the folder and double-click **`Start Stock Forecast.bat`**.
   If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**.

The first start sets itself up (5-15 minutes, about 0.5 GB): it downloads a private copy of Python
into a `python` folder inside this folder. Nothing is installed on your computer, and deleting the
folder removes everything. The first forecast then takes around 15 minutes to build; later starts are quick.
Needs Windows 10 or 11 and an internet connection. Please note that this does NOT provide any type of investment or financial advice; it's just there for you to see. Just to keep things clear, you have a better chance at flipping a coin to decide to buy or sell than our program😭✌️ (We hope to train our system so eventually it can actually provide something with real value and evidence)

## Website (live news + advice)
Double-click **`Start Stock Forecast.bat`**. It opens http://127.0.0.1:8050 (this PC only) and keeps
running while its window is open: news every 15 minutes (Google News + Yahoo Finance, scored by
FinBERT on this PC), prices/model/company facts every 6 hours. Click any stock for statistics and
short-term / long-term Buy-Hold-Sell verdicts. Rules: `stockpred/auto_reason.py`, `stockpred/advice.py`.

## Quick start
```powershell
.\.venv\Scripts\python run.py backtest --sanity   # full out-of-sample test + leakage check
.\.venv\Scripts\python run.py predict             # P(up), P(down), 80% price range for next 5 days
.\.venv\Scripts\python run.py backtest --refresh  # re-download prices first
```
Fresh setup: `python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt`

Outputs go to `reports/` (metrics CSVs and `equity_curves.png`).

## How it works
| Step | File | What |
|---|---|---|
| Data | `stockpred/data.py` | Adjusted daily close/volume from Yahoo Finance, cached in `data/` |
| Features | `stockpred/features.py` | 33 features: returns, 12-1 momentum, volatility, MA gaps, RSI, volume z-score, market regime, cross-sectional ranks |
| Target | `stockpred/features.py` | 1 if the stock's 5-day forward return > SPY's |
| Models | `stockpred/models.py` | `momentum` (no-training baseline), `logistic`, `gboost` (gradient-boosted trees) |
| Backtest | `stockpred/backtest.py` | Retrain every 63 days on data whose labels were already known (embargoed), predict the next 63 days, hold top 5, pay 10 bps per turnover |

All settings live in `stockpred/config.py`.

## Reading the results
- **AUC / accuracy** near 0.50 is normal. 0.51–0.53 out of sample is realistic. Anything much higher usually means a bug.
- **t-stat vs EW** is the key number: how sure we can be that the strategy beats simply holding all 20 stocks. Below ~2, the result could easily be luck.
- **Sanity check** retrains on shuffled labels. AUC should be about 0.50. If it isn't, information is leaking from the future.

## Known limitations (be skeptical)
- **Survivorship bias:** the 20 tickers are today's winners, so every strategy on them looks better than it would have in real time.
- Yahoo data is free and unofficial, with occasional errors or gaps.
- No dividends-timing, borrow, taxes, or market-impact modelling beyond a flat cost.
- Testing many ideas on the same history inflates results (multiple-testing bias). Keep a holdout period you never tune on.

Research tool, not financial advice.

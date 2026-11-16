"""Company facts from Yahoo Finance (free): valuation, analyst targets, next earnings date.
Cached in data/fundamentals.json and refreshed at most every 12 hours."""
import json
import time
from datetime import date, datetime, timezone

import yfinance as yf

FIELDS = ["trailingPE", "forwardPE", "dividendYield", "targetMeanPrice", "targetLowPrice",
          "targetHighPrice", "recommendationKey", "numberOfAnalystOpinions", "marketCap", "sector"]
MAX_AGE_H = 12


def _next_earnings(t):
    try:
        cal = t.calendar or {}
        dates = cal.get("Earnings Date") or []
        future = sorted(d for d in dates if isinstance(d, date) and d >= date.today())
        return future[0].isoformat() if future else None
    except Exception:
        return None


def _fetch_one(ticker):
    t = yf.Ticker(ticker)
    out = {"ticker": ticker}
    try:
        info = t.info or {}
        out.update({k: info.get(k) for k in FIELDS})
    except Exception as e:
        out["error"] = type(e).__name__
    out["next_earnings"] = _next_earnings(t)
    return out


def load_fundamentals(cfg, force=False):
    path = cfg.data_dir / "fundamentals.json"
    if path.exists() and not force:
        cached = json.loads(path.read_text(encoding="utf-8"))
        age_h = (datetime.now(timezone.utc) - datetime.fromisoformat(cached["fetched_at"])).total_seconds() / 3600
        if age_h < MAX_AGE_H and set(cfg.tickers) <= set(cached["data"]):
            return cached["data"]
    data = {}
    for tk in cfg.tickers:
        data[tk] = _fetch_one(tk)
        time.sleep(0.3)   # be polite to Yahoo
    path.write_text(json.dumps({"fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                "data": data}, indent=1), encoding="utf-8")
    return data

"""Company facts from Yahoo Finance (free): valuation, analyst targets, next earnings date.
Cached in data/fundamentals.json and refreshed at most every 12 hours.
The "analyst" part (rating counts, estimate revisions) is shown on the page for reading only:
it was backtested as a model input and did not help (see stockpred/analyst.py)."""
import json
import time
from datetime import date, datetime, timezone

import yfinance as yf

FIELDS = ["trailingPE", "forwardPE", "dividendYield", "targetMeanPrice", "targetLowPrice",
          "targetHighPrice", "recommendationKey", "numberOfAnalystOpinions", "marketCap", "sector"]
MAX_AGE_H = 12
VERSION = 2   # bump when new fields are added, so old caches are refreshed
RATINGS = ["strongBuy", "buy", "hold", "sell", "strongSell"]


def _next_earnings(t):
    try:
        cal = t.calendar or {}
        dates = cal.get("Earnings Date") or []
        future = sorted(d for d in dates if isinstance(d, date) and d >= date.today())
        return future[0].isoformat() if future else None
    except Exception:
        return None


def _analyst(t):
    """Rating counts now and 3 months ago, and how next year's profit estimate has moved."""
    out = {}
    try:
        rec = t.recommendations
        if rec is not None and len(rec):
            rec = rec.set_index("period")
            for key, period in (("now", "0m"), ("before", "-3m")):
                if period in rec.index:
                    out[key] = {k: int(rec.loc[period, k] or 0) for k in RATINGS}
    except Exception:
        pass
    try:
        rv = t.eps_revisions
        if rv is not None and "+1y" in rv.index:
            out["est_up_30d"] = int(rv.loc["+1y"].get("upLast30days") or 0)
            out["est_down_30d"] = int(rv.loc["+1y"].get("downLast30days") or 0)
    except Exception:
        pass
    try:
        tr = t.eps_trend
        if tr is not None and "+1y" in tr.index and tr.loc["+1y", "90daysAgo"]:
            out["est_change_90d_pct"] = round(float(tr.loc["+1y", "current"] / tr.loc["+1y", "90daysAgo"] - 1) * 100, 2)
    except Exception:
        pass
    return out


def _fetch_one(ticker):
    t = yf.Ticker(ticker)
    out = {"ticker": ticker}
    try:
        info = t.info or {}
        out.update({k: info.get(k) for k in FIELDS})
    except Exception as e:
        out["error"] = type(e).__name__
    out["next_earnings"] = _next_earnings(t)
    out["analyst"] = _analyst(t)
    return out


def load_fundamentals(cfg, force=False):
    path = cfg.data_dir / "fundamentals.json"
    if path.exists() and not force:
        cached = json.loads(path.read_text(encoding="utf-8"))
        age_h = (datetime.now(timezone.utc) - datetime.fromisoformat(cached["fetched_at"])).total_seconds() / 3600
        if age_h < MAX_AGE_H and cached.get("version") == VERSION and set(cfg.tickers) <= set(cached["data"]):
            return cached["data"]
    data = {}
    for tk in cfg.tickers:
        data[tk] = _fetch_one(tk)
        time.sleep(0.3)   # be polite to Yahoo
    path.write_text(json.dumps({"version": VERSION, "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                "data": data}, indent=1), encoding="utf-8")
    return data

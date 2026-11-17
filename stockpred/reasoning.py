"""Reasoned forecasts: Claude's research adjusts the model, and every forecast is logged and graded.

data/outlook.csv (written by Claude after researching news/events), one row per stock:
  ticker    e.g. NVDA
  lean      -2..+2   direction lean from the reasoning (0 = no lean). Each step moves P(up) by 3 pts.
  vol_mult  >= 0.5   how much bigger than normal the move is likely to be (1.0 = normal,
                     1.5 = e.g. earnings week). Widens/narrows the 80% range around today's price.
  event     upcoming event, if any (e.g. "Earnings Tue Nov 17")
  reason    the reasoning in plain words
  written_at  UTC timestamp
Stocks without a row keep the model's numbers unchanged.
"""
from datetime import datetime, timezone

import numpy as np
import pandas as pd

OUTLOOK_FILE = "outlook.csv"
LOG_FILE = "forecast_log.csv"
LEAN_STEP = 0.03


def load_outlook(cfg, max_age_days=4):
    path = cfg.data_dir / OUTLOOK_FILE
    if not path.exists():
        return None
    o = pd.read_csv(path).set_index("ticker")
    age = (datetime.now(timezone.utc) - pd.to_datetime(o["written_at"], utc=True).max()).days
    if age > max_age_days:
        return None
    return o.fillna({"lean": 0, "vol_mult": 1.0, "event": "", "reason": ""})


def apply_reasoning(fc, outlook):
    out = fc.copy()
    out["lean"], out["vol_mult"], out["event"], out["reason"] = 0, 1.0, "", ""
    if outlook is not None:
        common = out.index.intersection(outlook.index)
        for col in ("lean", "vol_mult", "event", "reason"):
            out.loc[common, col] = outlook.loc[common, col]
    out["vol_mult"] = out["vol_mult"].astype(float).clip(lower=0.5)
    out["p_up_r"] = (out["p_up"] + LEAN_STEP * out["lean"].astype(float)).clip(0.05, 0.95)
    out["low_r"] = out["price"] - (out["price"] - out["low"]) * out["vol_mult"]
    out["high_r"] = out["price"] + (out["high"] - out["price"]) * out["vol_mult"]
    return out


def log_forecast(out, as_of, cfg):
    """Append today's forecast so it can be graded once the outcome is known."""
    cfg.reports_dir.mkdir(parents=True, exist_ok=True)
    path = cfg.reports_dir / LOG_FILE
    rows = out[["price", "p_up", "p_up_r", "low", "high", "low_r", "high_r", "lean", "vol_mult"]].copy()
    rows.insert(0, "as_of", f"{as_of:%Y-%m-%d}")
    rows.insert(0, "logged_at", datetime.now(timezone.utc).isoformat(timespec="seconds"))
    rows = rows.reset_index().rename(columns={"index": "ticker"})
    if path.exists():
        rows = pd.concat([pd.read_csv(path), rows])
    rows.drop_duplicates(["as_of", "ticker"], keep="last").to_csv(path, index=False)


def _graded(close, cfg):
    """Every logged forecast whose 5 trading days have passed, with what actually happened.

    Compares on the same adjusted price series (ratio from the forecast day), so a dividend
    paid during the week does not count as a price drop."""
    path = cfg.reports_dir / LOG_FILE
    if not path.exists():
        return None, 0
    log = pd.read_csv(path)
    dates = close.index
    done, pending = [], 0
    for r in log.itertuples():
        if r.ticker not in close.columns:
            continue
        i = dates.searchsorted(pd.Timestamp(r.as_of))
        if i >= len(dates) or dates[i] != pd.Timestamp(r.as_of):
            continue
        if i + cfg.horizon >= len(dates):
            pending += 1
            continue
        start, end = close[r.ticker].iloc[i], close[r.ticker].iloc[i + cfg.horizon]
        final = r.price * end / start                    # outcome in the forecast day's money
        done.append({"ticker": r.ticker, "as_of": r.as_of, "price": r.price, "final": final,
                     "up": float(final > r.price), "p_up": r.p_up, "p_up_r": r.p_up_r,
                     "low_r": r.low_r, "high_r": r.high_r,
                     "in_model": r.low <= final <= r.high, "in_reasoned": r.low_r <= final <= r.high_r,
                     "adjusted": (r.lean != 0) or (r.vol_mult != 1.0)})
    return (pd.DataFrame(done) if done else None), pending


def grade(close, cfg):
    d, pending = _graded(close, cfg)
    if d is None:
        return {"graded": 0, "pending": pending} if pending else None
    adj = d[d["adjusted"]]
    return {
        "graded": len(d), "pending": pending, "adjusted": len(adj),
        "brier_model": np.mean((d["p_up"] - d["up"]) ** 2),
        "brier_reasoned": np.mean((d["p_up_r"] - d["up"]) ** 2),
        "cover_model": d["in_model"].mean(), "cover_reasoned": d["in_reasoned"].mean(),
        "adj_cover_model": adj["in_model"].mean() if len(adj) else np.nan,
        "adj_cover_reasoned": adj["in_reasoned"].mean() if len(adj) else np.nan,
    }


def track_record(close, cfg):
    """Plain summary of how the published forecasts did, for the website."""
    d, pending = _graded(close, cfg)
    if d is None:
        return {"graded": 0, "pending": pending}
    pct = lambda x: round(float(x) * 100, 1)
    called = (d["p_up_r"] > 0.5) == (d["up"] == 1)
    latest = d[d["as_of"] == d["as_of"].max()].sort_values("ticker")
    adj = d[d["adjusted"]]
    return {
        "graded": len(d), "pending": pending, "weeks": int(d["as_of"].nunique()),
        "first": d["as_of"].min(), "last": d["as_of"].max(),
        "range_hit_pct": pct(d["in_reasoned"].mean()),
        "direction_hit_pct": pct(called.mean()),
        "always_up_hit_pct": pct(d["up"].mean()),            # what "always say up" would have scored
        "news_changed": len(adj),
        "brier_model": round(float(np.mean((d["p_up"] - d["up"]) ** 2)), 4),
        "brier_news": round(float(np.mean((d["p_up_r"] - d["up"]) ** 2)), 4),
        "latest": [{"ticker": r.ticker, "as_of": r.as_of, "price": round(r.price, 2),
                    "up_pct": round(r.p_up_r * 100), "low": round(r.low_r, 2), "high": round(r.high_r, 2),
                    "final": round(r.final, 2), "in_range": bool(r.in_reasoned),
                    "direction_right": bool((r.p_up_r > 0.5) == (r.up == 1))}
                   for r in latest.itertuples()],
    }

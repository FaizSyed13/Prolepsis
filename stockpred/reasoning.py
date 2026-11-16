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


def grade(close, cfg):
    path = cfg.reports_dir / LOG_FILE
    if not path.exists():
        return None
    log = pd.read_csv(path)
    dates = close.index
    done, pending = [], 0
    for r in log.itertuples():
        i = dates.searchsorted(pd.Timestamp(r.as_of))
        if i >= len(dates) or dates[i] != pd.Timestamp(r.as_of):
            continue
        if i + cfg.horizon >= len(dates):
            pending += 1
            continue
        final = close[r.ticker].iloc[i + cfg.horizon]
        done.append({"ticker": r.ticker, "as_of": r.as_of, "up": float(final > r.price),
                     "p_up": r.p_up, "p_up_r": r.p_up_r,
                     "in_model": r.low <= final <= r.high, "in_reasoned": r.low_r <= final <= r.high_r,
                     "adjusted": (r.lean != 0) or (r.vol_mult != 1.0)})
    if not done:
        return {"graded": 0, "pending": pending}
    d = pd.DataFrame(done)
    adj = d[d["adjusted"]]
    return {
        "graded": len(d), "pending": pending, "adjusted": len(adj),
        "brier_model": np.mean((d["p_up"] - d["up"]) ** 2),
        "brier_reasoned": np.mean((d["p_up_r"] - d["up"]) ** 2),
        "cover_model": d["in_model"].mean(), "cover_reasoned": d["in_reasoned"].mean(),
        "adj_cover_model": adj["in_model"].mean() if len(adj) else np.nan,
        "adj_cover_reasoned": adj["in_reasoned"].mean() if len(adj) else np.nan,
    }

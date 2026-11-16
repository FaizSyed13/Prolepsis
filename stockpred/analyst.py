"""Free analyst data from Yahoo Finance, turned into day-by-day features with no look-ahead.

- Earnings surprises (reported EPS vs. the analyst estimate), history back to ~2002.
- Analyst rating changes and price-target changes, dense from ~2019 (patchy before).

Every event counts only from the trading day AFTER it happened, so a 4 PM earnings report or
an after-hours downgrade can never leak into that day's features. Cached in
data/analyst.pkl, refreshed at most every 12 hours.
"""
import time

import numpy as np
import pandas as pd
import yfinance as yf

MAX_AGE_H = 12
WINDOW = "90D"          # rating / target changes counted over the last 90 calendar days

COLS = ["earn_surprise", "earn_days", "an_rating_90", "an_pt_90", "an_pt_chg_90", "an_n_90"]
RANKED = ["earn_surprise", "an_rating_90", "an_pt_90", "an_pt_chg_90"]


def _fetch(ticker):
    t = yf.Ticker(ticker)
    ud = t.upgrades_downgrades
    ud = pd.DataFrame() if ud is None else ud.copy()
    ed = t.get_earnings_dates(limit=100)
    ed = pd.DataFrame() if ed is None else ed.copy()
    return ud, ed


def load_raw(cfg, force=False):
    path = cfg.data_dir / "analyst.pkl"
    if path.exists() and not force:
        cached = pd.read_pickle(path)
        age_h = (pd.Timestamp.now(tz="UTC") - cached["fetched_at"]).total_seconds() / 3600
        if age_h < MAX_AGE_H and set(cfg.tickers) <= set(cached["data"]):
            return cached["data"]
    print("Downloading analyst data from Yahoo Finance...")
    data = {}
    for tk in cfg.tickers:
        data[tk] = _fetch(tk)
        time.sleep(0.3)
    pd.to_pickle({"fetched_at": pd.Timestamp.now(tz="UTC"), "data": data}, path)
    return data


def _known_from(stamps, days):
    """Map event timestamps to the first trading day on which they are known (the next one)."""
    ts = pd.DatetimeIndex(stamps)
    if ts.tz is not None:
        ts = ts.tz_convert("America/New_York").tz_localize(None)
    pos = days.searchsorted(ts.normalize(), side="right")   # strictly after the event's date
    ok = pos < len(days)
    return pos, ok


def _one(ud, ed, days):
    out = pd.DataFrame(index=days, columns=COLS, dtype=float)

    # --- earnings surprise and time since the last report ---
    e = ed.dropna(subset=["Surprise(%)"]) if len(ed) else ed
    if len(e):
        pos, ok = _known_from(e.index, days)
        s = pd.Series(e["Surprise(%)"].clip(-50, 50).to_numpy()[ok], index=days[pos[ok]])
        s = s[~s.index.duplicated(keep="last")].sort_index()
        out["earn_surprise"] = s.reindex(days).ffill()
        last_day = pd.Series(np.arange(len(days)), index=days).where(days.isin(s.index)).ffill()
        out["earn_days"] = (np.arange(len(days)) - last_day).clip(upper=63)

    # --- analyst rating changes and price-target changes ---
    if len(ud):
        pos, ok = _known_from(ud.index, days)
        u = ud.reset_index(drop=True)[ok].assign(day=days[pos[ok]])
        ev = pd.DataFrame({
            "rating": u["Action"].map({"up": 1, "down": -1}).fillna(0).to_numpy(),
            "pt": u["priceTargetAction"].map({"Raises": 1, "Lowers": -1}).fillna(0).to_numpy(),
            "n": 1.0,
        }, index=pd.DatetimeIndex(u["day"])).groupby(level=0).sum().reindex(days, fill_value=0)
        roll = ev.rolling(WINDOW).sum()
        out["an_rating_90"] = roll["rating"] / (roll["n"] + 2)   # +2 shrinks thin evidence to 0
        out["an_pt_90"] = roll["pt"] / (roll["n"] + 2)
        out["an_n_90"] = roll["n"]

        # Size of target changes (new target / old target - 1). Both numbers come from the same
        # note, so this is unaffected by stock splits (Yahoo's old target LEVELS are not always
        # split-adjusted, so target-vs-price "upside" cannot be backtested reliably).
        tg = u.loc[(u["currentPriceTarget"] > 0) & (u["priorPriceTarget"] > 0)]
        if len(tg):
            chg = (tg["currentPriceTarget"] / tg["priorPriceTarget"] - 1).clip(-0.5, 0.5).to_numpy()
            c = pd.DataFrame({"chg": chg, "k": 1.0}, index=pd.DatetimeIndex(tg["day"]))                 .groupby(level=0).sum().reindex(days, fill_value=0).rolling(WINDOW).sum()
            out["an_pt_chg_90"] = c["chg"] / (c["k"] + 2)

    # No information = neutral 0 (the model also sees an_n_90 to know how much there was).
    out[["an_rating_90", "an_pt_90", "an_pt_chg_90", "an_n_90"]] = \
        out[["an_rating_90", "an_pt_90", "an_pt_chg_90", "an_n_90"]].fillna(0)
    out["earn_days"] = out["earn_days"].fillna(63)
    return out


def analyst_wide(cfg, close, force=False):
    """{feature: DataFrame(date x ticker)} built from the cached raw data."""
    raw = load_raw(cfg, force)
    days = close.index
    per = {tk: _one(*raw[tk], days) for tk in cfg.tickers if tk in close.columns}
    return {c: pd.DataFrame({tk: f[c] for tk, f in per.items()}) for c in COLS}


def latest_snapshot(cfg):
    """Current analyst view for the website: estimate revisions and rating counts (not backtested)."""
    out = {}
    for tk in cfg.tickers:
        t = yf.Ticker(tk)
        row = {}
        try:
            rv = t.eps_revisions
            if rv is not None and "+1y" in rv.index:
                r = rv.loc["+1y"]
                row["eps_rev_up_30d"] = int(r.get("upLast30days") or 0)
                row["eps_rev_down_30d"] = int(r.get("downLast30days") or 0)
        except Exception:
            pass
        try:
            tr = t.eps_trend
            if tr is not None and "+1y" in tr.index and tr.loc["+1y", "90daysAgo"]:
                row["eps_next_year_change_90d_pct"] = round(
                    (tr.loc["+1y", "current"] / tr.loc["+1y", "90daysAgo"] - 1) * 100, 2)
        except Exception:
            pass
        out[tk] = row
        time.sleep(0.3)
    return out

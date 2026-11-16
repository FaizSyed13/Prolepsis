"""Feature engineering. Every feature at date t uses only data available at the close of t."""
import numpy as np
import pandas as pd

# Features we also convert to cross-sectional ranks (stock vs. its peers on the same day).
RANKED = ["ret_5", "ret_21", "ret_63", "mom_12_1", "vol_21", "ma_gap_50",
          "ma_gap_200", "vlm_z21", "rsi_14", "dist_high_252"]
MARKET = ["ret_5", "ret_21", "ret_63", "vol_21", "ma_gap_200"]


def _rsi(close, n=14):
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn)


def _wide_features(close, volume):
    r = close.pct_change(fill_method=None)
    f = {}
    for n in (1, 5, 21, 63, 126, 252):
        f[f"ret_{n}"] = close.pct_change(n, fill_method=None)
    f["mom_12_1"] = close.shift(21) / close.shift(252) - 1      # classic 12-1 momentum
    f["vol_21"] = r.rolling(21).std() * np.sqrt(252)
    f["vol_63"] = r.rolling(63).std() * np.sqrt(252)
    f["vol_ratio"] = f["vol_21"] / f["vol_63"]
    for n in (10, 50, 200):
        f[f"ma_gap_{n}"] = close / close.rolling(n).mean() - 1
    lv = np.log(volume.where(volume > 0))
    f["vlm_z21"] = (lv - lv.rolling(21).mean()) / lv.rolling(21).std()
    f["rsi_14"] = _rsi(close)
    f["dist_high_252"] = close / close.rolling(252).max() - 1
    return f


def _stack(wide):
    s = wide.stack(future_stack=True)
    s.index.names = ["date", "ticker"]
    return s


def build_panel(close, volume, cfg, extra=None, extra_ranked=()):
    """Long panel indexed by (date, ticker) with features, forward returns and the target.

    `extra` = optional {name: DataFrame(date x ticker)} of additional features (e.g. analyst data);
    names in `extra_ranked` also get a cross-sectional rank.
    Returns (panel, feature_cols, bench_fwd). Rows on the most recent `horizon` days have
    NaN target (future unknown) and are used only for live prediction.
    """
    bench = cfg.benchmark
    stocks = [t for t in cfg.tickers if t in close.columns]
    wide = _wide_features(close, volume)
    extra = extra or {}
    for k, v in extra.items():
        wide[k] = v.reindex(index=close.index, columns=close.columns)

    panel = pd.concat({k: _stack(v[stocks]) for k, v in wide.items()}, axis=1)

    mkt = pd.DataFrame({f"mkt_{k}": wide[k][bench] for k in MARKET})
    mkt.index.name = "date"
    panel = panel.join(mkt, on="date")
    panel["rel_ret_21"] = panel["ret_21"] - panel["mkt_ret_21"]
    panel["rel_ret_63"] = panel["ret_63"] - panel["mkt_ret_63"]

    ranks = panel.groupby(level="date")[RANKED + list(extra_ranked)].rank(pct=True).add_prefix("rank_")
    panel = pd.concat([panel, ranks], axis=1)
    feature_cols = list(panel.columns)

    # Forward-looking columns: ONLY used as labels / for scoring, never as features.
    fwd = close.shift(-cfg.horizon) / close - 1
    panel["fwd_ret"] = _stack(fwd[stocks])
    panel["fwd_excess"] = _stack(fwd[stocks].sub(fwd[bench], axis=0))
    panel["target"] = np.where(panel["fwd_excess"].isna(), np.nan,
                               (panel["fwd_excess"] > 0).astype(float))
    # Absolute direction: does the price go up over the next `horizon` days?
    panel["up"] = np.where(panel["fwd_ret"].isna(), np.nan, (panel["fwd_ret"] > 0).astype(float))
    panel["close"] = _stack(close[stocks])

    panel = panel.replace([np.inf, -np.inf], np.nan).dropna(subset=feature_cols).sort_index()
    return panel, feature_cols, fwd[bench]

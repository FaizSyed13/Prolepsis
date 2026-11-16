"""Calibrated probabilities of going up / dropping, plus a calibrated likely price range.

1. Walk-forward: get genuinely out-of-sample (OOS) predictions for every past day.
2. Calibration: learn how the model's raw numbers map to what actually happened
   (isotonic regression for P(up); conformal widening for the price range).
3. Honest check: fit the calibration on the first 70% of OOS history and grade it on
   the last 30%, which it has never seen.
"""
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

from .backtest import walk_forward
from .models import QUANTILES, make_model

COVERAGE = QUANTILES["q_hi"] - QUANTILES["q_lo"]   # 0.80 target range coverage
BINS = [0, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 1.0]


def oos_predictions(panel, feature_cols, model_name, cfg, use_cache=True, max_age_days=30):
    """Walk-forward history used for calibration. It takes minutes to rebuild, so a cached copy
    up to `max_age_days` old is reused (calibration barely changes from one day to the next)."""
    last = panel.index.get_level_values("date").max()
    path = cfg.data_dir / f"oos_{model_name}_h{cfg.horizon}.pkl"
    if use_cache and path.exists():
        cached = pd.read_pickle(path)
        if (last - cached["last"]).days <= max_age_days:
            return cached["oos"]

    print("Training on history, walk-forward (first run takes a few minutes)...")
    oos = pd.DataFrame({
        "p_up": walk_forward(panel, feature_cols, model_name, cfg, target="up"),
        "q_lo": walk_forward(panel, feature_cols, "q_lo", cfg, target="fwd_ret"),
        "q_hi": walk_forward(panel, feature_cols, "q_hi", cfg, target="fwd_ret"),
    }).join(panel[["up", "fwd_ret"]]).dropna(subset=["up"])
    pd.to_pickle({"last": last, "oos": oos}, path)
    return oos


def _fit_calibration(oos):
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.02, y_max=0.98)
    iso.fit(oos["p_up"], oos["up"])
    # Conformalized quantile regression: widen (or narrow) the range just enough that
    # it would have contained the actual outcome COVERAGE of the time.
    err = np.maximum(oos["q_lo"] - oos["fwd_ret"], oos["fwd_ret"] - oos["q_hi"])
    adj = np.quantile(err, min(1.0, COVERAGE * (1 + 1 / len(err))))
    return iso, adj


def calibration_report(oos, split=0.7):
    dates = oos.index.get_level_values("date").unique().sort_values()
    cut = dates[int(len(dates) * split)]
    d = oos.index.get_level_values("date")
    fit, test = oos[d < cut], oos[d >= cut]
    iso, adj = _fit_calibration(fit)

    y = test["up"].to_numpy()
    p = iso.predict(test["p_up"])
    base = fit["up"].mean()                                   # "always guess the usual rate"
    brier = lambda q: np.mean((q - y) ** 2)
    lo, hi = test["q_lo"] - adj, test["q_hi"] + adj
    inside = ((test["fwd_ret"] >= lo) & (test["fwd_ret"] <= hi)).mean()

    table = (pd.DataFrame({"pred": p, "actual": y})
             .assign(bin=lambda x: pd.cut(x["pred"], BINS))
             .groupby("bin", observed=True)
             .agg(model_said=("pred", "mean"), actually_up=("actual", "mean"), cases=("actual", "size")))
    return {
        "test_start": cut, "test_end": dates[-1],
        "base_rate": base,
        "accuracy": ((p > 0.5) == (y == 1)).mean(),
        "naive_accuracy": max(np.mean(y == 1), np.mean(y == 0)),
        "skill": 1 - brier(p) / brier(np.full_like(p, base)),  # >0 = better than naive guess
        "range_coverage": inside,
        "range_width": (hi - lo).median(),
        "table": table,
    }


def forecast_latest(panel, feature_cols, model_name, cfg, oos):
    iso, adj = _fit_calibration(oos)
    last = panel.index.get_level_values("date").max()
    today = panel.xs(last, level="date")
    X = today[feature_cols]

    train = panel[panel["up"].notna()]
    clf = make_model(model_name, cfg.seed).fit(train[feature_cols], train["up"].astype(int))
    p_up = iso.predict(clf.predict_proba(X)[:, 1])
    q = {}
    for name in QUANTILES:
        q[name] = make_model(name, cfg.seed).fit(train[feature_cols], train["fwd_ret"]).predict(X)
    lo = np.minimum(q["q_lo"], q["q_hi"]) - adj
    hi = np.maximum(q["q_lo"], q["q_hi"]) + adj

    out = pd.DataFrame({
        "price": today["close"],
        "p_up": p_up,
        "p_down": 1 - p_up,
        "low": today["close"] * (1 + lo),
        "high": today["close"] * (1 + hi),
    }, index=today.index).sort_values("p_up", ascending=False)
    return out, last

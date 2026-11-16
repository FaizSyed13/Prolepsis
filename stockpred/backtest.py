import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

from .models import is_classifier, make_model


def walk_forward(panel, feature_cols, model_name, cfg, target="target", shuffle_labels=False):
    """Out-of-sample scores for every row after the initial training period.

    At each retrain point i, the model is trained only on rows whose label was fully
    known by date i (label at t needs the close at t+horizon), plus a 1-day buffer.
    Classifiers return P(label=1); quantile models return the predicted return quantile.
    """
    dates = panel.index.get_level_values("date").unique().sort_values()
    date_lv = panel.index.get_level_values("date")
    labeled = panel[target].notna().to_numpy()
    clf = is_classifier(model_name)
    rng = np.random.default_rng(cfg.seed)
    out = []

    for i in range(cfg.min_train_days, len(dates), cfg.retrain_every):
        test_dates = dates[i:i + cfg.retrain_every]
        test = panel[date_lv.isin(test_dates)]

        if model_name == "momentum":
            score = test["rank_mom_12_1"].to_numpy()
        else:
            cutoff = dates[i - cfg.horizon - 1]
            train = panel[labeled & (date_lv <= cutoff)]
            y = train[target].to_numpy()
            if clf:
                y = y.astype(int)
            if shuffle_labels:
                y = rng.permutation(y)
            model = make_model(model_name, cfg.seed)
            model.fit(train[feature_cols], y)
            score = (model.predict_proba(test[feature_cols])[:, 1] if clf
                     else model.predict(test[feature_cols]))

        out.append(pd.Series(score, index=test.index))

    return pd.concat(out).rename("score")


def perf_stats(r, periods_per_year):
    eq = (1 + r).cumprod()
    years = len(r) / periods_per_year
    return {
        "CAGR": eq.iloc[-1] ** (1 / years) - 1,
        "Vol": r.std() * np.sqrt(periods_per_year),
        "Sharpe": r.mean() / r.std() * np.sqrt(periods_per_year),
        "MaxDD": (eq / eq.cummax() - 1).min(),
    }


def evaluate(panel, score, bench_fwd, cfg):
    """Prediction-quality metrics + a long-only top-k portfolio rebalanced every `horizon` days."""
    df = panel.loc[score.index, ["fwd_ret", "fwd_excess", "target"]].assign(score=score)
    lab = df.dropna(subset=["target"])

    base_rate = lab["target"].mean()
    ic = lab.groupby(level="date").apply(
        lambda g: g["score"].corr(g["fwd_excess"], method="spearman"))
    pred = {
        "Accuracy": ((lab["score"] > 0.5) == (lab["target"] == 1)).mean(),
        "Majority-class acc": max(base_rate, 1 - base_rate),
        "AUC": roc_auc_score(lab["target"], lab["score"]),
        "Mean IC": ic.mean(),
    }

    # Non-overlapping holding periods so each return is independent of the last.
    groups = {d: g.droplevel("date") for d, g in lab.groupby(level="date")}
    rebal = sorted(groups)[::cfg.horizon]
    prev_w = pd.Series(dtype=float)
    rows = []
    for d in rebal:
        g = groups[d]
        top = g.nlargest(cfg.top_k, "score")
        w = pd.Series(1 / len(top), index=top.index)
        turnover = w.sub(prev_w, fill_value=0).abs().sum()
        rows.append({
            "date": d,
            "strategy": (top["fwd_ret"] * w).sum() - turnover * cfg.cost_bps / 1e4,
            "equal_weight": g["fwd_ret"].mean(),
            "spy": bench_fwd.loc[d],
            "turnover": turnover,
        })
        prev_w = w
    periods = pd.DataFrame(rows).set_index("date")

    ppy = 252 / cfg.horizon
    excess = periods["strategy"] - periods["equal_weight"]
    strat = perf_stats(periods["strategy"], ppy)
    strat.update({
        "Avg turnover": periods["turnover"].mean(),
        "Win% vs SPY": (periods["strategy"] > periods["spy"]).mean(),
        # t-stat of return over simply holding all stocks: |t| < 2 means "could easily be luck".
        "t-stat vs EW": excess.mean() / excess.std() * np.sqrt(len(excess)),
    })
    return pred, strat, periods

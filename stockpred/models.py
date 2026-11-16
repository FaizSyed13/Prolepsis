from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

# "momentum" is a no-training baseline: score = today's cross-sectional rank of 12-1 momentum.
MODELS = ["momentum", "logistic", "gboost"]

# Quantile models for the likely price range: 10th and 90th percentile of the 5-day return,
# i.e. an 80% range (before calibration).
QUANTILES = {"q_lo": 0.10, "q_hi": 0.90}

_TREE = dict(learning_rate=0.02, max_leaf_nodes=15, min_samples_leaf=300,
             l2_regularization=5.0, max_features=0.7, early_stopping=False)


def is_classifier(name):
    return name not in QUANTILES


def make_model(name, seed=42):
    if name == "logistic":
        return Pipeline([("scale", StandardScaler()),
                         ("lr", LogisticRegression(C=0.05, max_iter=2000))])
    if name == "gboost":
        # Gradient-boosted trees (LightGBM-style). Deliberately conservative:
        # financial data is very noisy and easy to overfit.
        return HistGradientBoostingClassifier(max_iter=300, random_state=seed, **_TREE)
    if name in QUANTILES:
        return HistGradientBoostingRegressor(loss="quantile", quantile=QUANTILES[name],
                                             max_iter=200, random_state=seed, **_TREE)
    raise ValueError(f"Unknown model: {name}")

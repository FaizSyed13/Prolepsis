"""Stock prediction research pipeline.

    python run.py backtest                 # walk-forward test of all models vs. baselines
    python run.py backtest --sanity        # + leakage check: train on shuffled labels
    python run.py predict                  # rank stocks for the next 5 days (latest data)
    python run.py backtest --refresh       # re-download prices
"""
import argparse
import json
import os
import warnings

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from stockpred.backtest import evaluate, perf_stats, walk_forward
from stockpred.config import NAMES, ROOT, Config
from stockpred.data import candle_rows, load_prices
from stockpred.features import build_panel
from stockpred.models import MODELS
from stockpred.export import calibration_rows, forecast_rows
from stockpred.news import fetch_headlines
from stockpred.reasoning import apply_reasoning, grade, load_outlook, log_forecast
from stockpred.probability import calibration_report, forecast_latest, oos_predictions

warnings.filterwarnings("ignore", category=UserWarning)
pd.set_option("display.width", 160)


def load(cfg, refresh):
    close, volume = load_prices(cfg, refresh)
    panel, feature_cols, bench_fwd = build_panel(close, volume, cfg)
    d = panel.index.get_level_values("date")
    print(f"Panel: {len(panel):,} rows, {len(feature_cols)} features, "
          f"{d.min():%Y-%m-%d} -> {d.max():%Y-%m-%d}")
    return panel, feature_cols, bench_fwd


def cmd_backtest(cfg, args):
    panel, feature_cols, bench_fwd = load(cfg, args.refresh)
    pred_rows, strat_rows, curves = {}, {}, {}

    for name in args.models:
        print(f"Walk-forward: {name}...")
        score = walk_forward(panel, feature_cols, name, cfg)
        pred, strat, periods = evaluate(panel, score, bench_fwd, cfg)
        pred_rows[name], strat_rows[f"Top-{cfg.top_k} {name}"] = pred, strat
        curves[name] = (1 + periods["strategy"]).cumprod()

    ppy = 252 / cfg.horizon
    strat_rows["Equal-weight all 20"] = perf_stats(periods["equal_weight"], ppy)
    strat_rows[cfg.benchmark] = perf_stats(periods["spy"], ppy)
    curves["equal_weight"] = (1 + periods["equal_weight"]).cumprod()
    curves[cfg.benchmark] = (1 + periods["spy"]).cumprod()

    start, end = periods.index.min(), periods.index.max()
    print(f"\nOut-of-sample period: {start:%Y-%m-%d} -> {end:%Y-%m-%d} "
          f"({len(periods)} holding periods of {cfg.horizon} days, costs {cfg.cost_bps:g} bps)")
    print(f"\n=== Prediction quality: does the stock beat {cfg.benchmark} over the next "
          f"{cfg.horizon} days? ===")
    print(pd.DataFrame(pred_rows).T.round(4).to_string())
    print("\n=== Strategy performance ===")
    print(pd.DataFrame(strat_rows).T.round(3).to_string())

    if args.sanity:
        print("\nSanity check: gboost trained on SHUFFLED labels (should give AUC ~0.50)...")
        score = walk_forward(panel, feature_cols, "gboost", cfg, shuffle_labels=True)
        pred, _, _ = evaluate(panel, score, bench_fwd, cfg)
        verdict = "OK, no obvious leakage" if abs(pred["AUC"] - 0.5) < 0.02 else "SUSPICIOUS, investigate"
        print(f"  AUC = {pred['AUC']:.4f} -> {verdict}")

    cfg.reports_dir.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(pred_rows).T.to_csv(cfg.reports_dir / "prediction_metrics.csv")
    pd.DataFrame(strat_rows).T.to_csv(cfg.reports_dir / "strategy_metrics.csv")
    ax = pd.DataFrame(curves).plot(figsize=(11, 6), logy=True,
                                   title="Out-of-sample growth of $1 (log scale, after costs)")
    ax.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(cfg.reports_dir / "equity_curves.png", dpi=120)
    print(f"\nSaved reports to {cfg.reports_dir}")


def cmd_predict(cfg, args):
    panel, feature_cols, _ = load(cfg, args.refresh)
    oos = oos_predictions(panel, feature_cols, args.model, cfg, use_cache=not args.refresh)
    rep = calibration_report(oos)
    fc, last = forecast_latest(panel, feature_cols, args.model, cfg, oos)
    pct = lambda x: f"{x:.0%}"

    print(f"\n=== How trustworthy are the probabilities? "
          f"(graded on {rep['test_start']:%Y-%m-%d} -> {rep['test_end']:%Y-%m-%d}, unseen) ===")
    t = rep["table"]
    print("  When the model said...   stocks actually went up...   (cases)")
    for _, r in t.iterrows():
        print(f"     {r.model_said:>6.1%}                  {r.actually_up:>6.1%}               ({int(r.cases):,})")
    print(f"\n  Usual rate of going up in any {cfg.horizon}-day window: {pct(rep['base_rate'])}")
    print(f"  Direction accuracy: {rep['accuracy']:.1%}  (always guessing the common outcome: "
          f"{rep['naive_accuracy']:.1%})")
    print(f"  Skill vs. naive guess: {rep['skill']:+.2%}  (0% = no better than guessing the usual rate)")
    print(f"  80% price range actually contained the outcome: {rep['range_coverage']:.1%} of the time")

    outlook = load_outlook(cfg)
    out = apply_reasoning(fc, outlook)
    log_forecast(out, last, cfg)
    save_json(out, rep, last, cfg)

    print(f"\n=== Reasoned forecast for the next {cfg.horizon} trading days | prices as of {last:%Y-%m-%d} ===")
    print(f"{'Stock':<26}{'Price':>10}{'Model up':>10}{'Up':>6}{'Down':>6}    {'80% likely range':<22}Changed by reasoning")
    for tk, r in out.iterrows():
        label = f"{tk} ({NAMES.get(tk, tk)})"
        changes = []
        if r.lean:
            changes.append(f"lean {'up' if r.lean > 0 else 'down'}")
        if r.vol_mult != 1.0:
            changes.append(f"range x{r.vol_mult:g}")
        print(f"{label:<26}{r.price:>10.2f}{pct(r.p_up):>10}{pct(r.p_up_r):>6}{pct(1 - r.p_up_r):>6}    "
              f"{f'{r.low_r:,.2f} - {r.high_r:,.2f}':<22}{', '.join(changes)}")

    noted = out[out["reason"] != ""]
    if len(noted):
        print("\nReasoning:")
        for tk, r in noted.iterrows():
            ev = f" [{r.event}]" if r.event else ""
            print(f"  {tk} ({NAMES.get(tk, tk)}){ev}: {r.reason}")
    if outlook is None:
        print("\nNo recent outlook. Ask Claude to research the news and write data/outlook.csv.")
    print("\nReasoning adjustments are untested so far. Run `python run.py grade` after 5 trading days "
          "to see whether they beat the plain model.\nResearch output, not financial advice.")


def save_json(out, rep, last, cfg):
    """Website data: reports/site/forecast.json and calibration.json, each {rows, meta}."""
    site = cfg.reports_dir / "site"
    site.mkdir(parents=True, exist_ok=True)
    code = lambda f: (ROOT / "stockpred" / f).read_text(encoding="utf-8")
    as_of = f"{last:%Y-%m-%d}"

    rows = forecast_rows(out, as_of)
    meta = [
        {"label": "Prices as of", "value": as_of},
        {"label": "Made by", "value": os.environ.get("MADE_BY", "python run.py predict, on the owner's PC")},
        {"label": "Inputs", "value": "Yahoo Finance daily prices since 2010; data/outlook.csv "
                                     "(Claude's research notes and adjustments)"},
        {"label": "reasoning.py", "value": code("reasoning.py"), "type": "code", "lang": "python"},
        {"label": "probability.py", "value": code("probability.py"), "type": "code", "lang": "python"},
    ]
    (site / "forecast.json").write_text(json.dumps({"rows": rows, "meta": meta}, indent=1), encoding="utf-8")

    cal = calibration_rows(rep)
    cal_meta = [
        {"label": "Test", "value": "Walk-forward: models only saw data from before each prediction; "
                                   "calibration fitted on earlier predictions and graded on this later, unseen period"},
        {"label": "probability.py", "value": code("probability.py"), "type": "code", "lang": "python"},
    ]
    (site / "calibration.json").write_text(json.dumps({"rows": cal, "meta": cal_meta}, indent=1), encoding="utf-8")

    candles = [{"ticker": tk, "date": c[0], "open": c[1], "high": c[2], "low": c[3], "close": c[4]}
               for tk, cs in candle_rows(cfg).items() for c in cs]
    data_py = (ROOT / "stockpred" / "data.py").read_text(encoding="utf-8")
    price_meta = [
        {"label": "Source", "value": "Yahoo Finance daily prices, adjusted for splits and dividends; last 6 months"},
        {"label": "data.py", "value": data_py, "type": "code", "lang": "python"},
    ]
    (site / "prices.json").write_text(json.dumps({"rows": candles, "meta": price_meta}), encoding="utf-8")


def cmd_grade(cfg, args):
    close, _ = load_prices(cfg, args.refresh)
    g = grade(close, cfg)
    if not g or not g.get("graded"):
        n = g["pending"] if g else 0
        print(f"Nothing to grade yet ({n} forecasts waiting for their {cfg.horizon} trading days). "
              "Run with --refresh once new prices are in.")
        return
    print(f"Graded {g['graded']} forecasts ({g['pending']} still pending, {g['adjusted']} changed by reasoning)")
    print(f"  Up/down error (Brier, lower is better): model {g['brier_model']:.4f} | "
          f"reasoned {g['brier_reasoned']:.4f}")
    print(f"  80% range hit rate, all stocks:        model {g['cover_model']:.0%} | "
          f"reasoned {g['cover_reasoned']:.0%}")
    if g["adjusted"]:
        print(f"  80% range hit rate, adjusted stocks:   model {g['adj_cover_model']:.0%} | "
              f"reasoned {g['adj_cover_reasoned']:.0%}")
    print("  A handful of weeks is too few to judge. Look for a consistent pattern over months.")


def cmd_news(cfg, args):
    df = fetch_headlines(cfg)
    print(f"Saved {len(df)} headlines for {df['ticker'].nunique()} stocks to "
          f"{cfg.data_dir / 'news_latest.csv'}")
    print("Next: ask Claude in Claude Code to score them, then run `python run.py predict`.")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("backtest")
    b.add_argument("--models", nargs="+", default=MODELS, choices=MODELS)
    b.add_argument("--sanity", action="store_true")
    b.add_argument("--refresh", action="store_true")
    pr = sub.add_parser("predict")
    pr.add_argument("--model", default="gboost", choices=["gboost", "logistic"])
    pr.add_argument("--refresh", action="store_true")
    sub.add_parser("news")
    g = sub.add_parser("grade")
    g.add_argument("--refresh", action="store_true")
    args = p.parse_args()

    cfg = Config()
    {"backtest": cmd_backtest, "predict": cmd_predict, "news": cmd_news,
     "grade": cmd_grade}[args.cmd](cfg, args)


if __name__ == "__main__":
    main()

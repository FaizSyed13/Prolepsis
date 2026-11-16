"""Per-stock statistics and rule-based Buy / Hold / Sell verdicts, short and long term.

These are transparent rules, not proven predictions:
- Short term (next 5 trading days) uses the forecast itself. The model's direction calls have
  not beaten simple guessing in testing, so a verdict needs a clear edge to move off Hold.
- Long term (1 year+) uses trend (price vs 200-day average), 12-month momentum, and Wall Street
  analysts' price targets and ratings. Trend and momentum are among the most studied signals in
  finance, but they work on average across many stocks, not reliably for any one stock.
"""
import numpy as np

SHORT_EDGE = 3       # percentage points above/below the usual up-rate needed for a lean
LONG_THRESHOLD = 2   # long-term score needed for Buy/Sell (range -4..+4)


def _r(x, nd=4):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), nd)


def price_stats(close, ticker, bench):
    p = close[ticker].dropna()
    b = close[bench].reindex(p.index).ffill()
    r, rb = p.pct_change().dropna(), b.pct_change().dropna()
    last = p.iloc[-1]
    back = lambda n: (last / p.iloc[-n - 1] - 1) if len(p) > n else np.nan
    w5 = p.iloc[-1260:]
    r1, rb1 = r.iloc[-252:], rb.reindex(r.index).iloc[-252:]
    years = len(p) / 252
    return {
        "first_date": f"{p.index[0]:%Y-%m-%d}",
        "ret_1m": _r(back(21)), "ret_6m": _r(back(126)), "ret_1y": _r(back(252)),
        "ret_3y": _r(back(756)), "ret_5y": _r(back(1260)),
        "spy_1y": _r(b.iloc[-1] / b.iloc[-253] - 1 if len(b) > 252 else np.nan),
        "cagr": _r((last / p.iloc[0]) ** (1 / years) - 1),
        "vol_1y": _r(r1.std() * np.sqrt(252)),
        "max_dd_5y": _r((w5 / w5.cummax() - 1).min()),
        "from_high_52w": _r(last / p.iloc[-252:].max() - 1),
        "high_52w": _r(p.iloc[-252:].max(), 2), "low_52w": _r(p.iloc[-252:].min(), 2),
        "ma200": _r(p.iloc[-200:].mean(), 2),
        "vs_ma200": _r(last / p.iloc[-200:].mean() - 1),
        "mom_12_1": _r(p.iloc[-22] / p.iloc[-253] - 1 if len(p) > 252 else np.nan),
        "beta_1y": _r(np.cov(r1, rb1)[0, 1] / np.var(rb1, ddof=1) if len(r1) > 20 else np.nan, 2),
    }


def _fmt_pct(x):
    return f"{x * 100:+.0f}%"


def short_term(row, base_rate_pct, range_median_pct, news):
    up, model = row["up_pct"], row["model_up_pct"]
    edge = up - base_rate_pct
    width = (row["high"] - row["low"]) / row["price"] * 100
    reasons = [f"Chance of going up this week: {up}%, against a usual {base_rate_pct:.0f}% for any week."]
    if up != model:
        reasons.append(f"The news moved it from the model's {model}%.")
    if news and news.get("n"):
        reasons.append(f"News over the last 3 days rates {news['score']:+.2f} on a −1 to +1 scale "
                       f"({news['n']} headlines).")
    if row.get("event"):
        reasons.append(f"{row['event']}. Expect a bigger move than usual, in either direction.")
    risk = "High" if width > 1.3 * range_median_pct else "Low" if width < 0.8 * range_median_pct else "Medium"
    reasons.append(f"80% range is ${row['low']:,.2f} to ${row['high']:,.2f} (about ±{width / 2:.1f}%). Risk this week: {risk.lower()}.")

    if edge >= SHORT_EDGE:
        verdict, why = "Buy", "The forecast leans clearly up."
    elif edge <= -SHORT_EDGE:
        verdict, why = "Sell", "The forecast leans clearly down."
    else:
        verdict, why = "Hold", "No clear edge either way this week."
    reasons.insert(0, why)
    reasons.append("In testing, the weekly up/down call was right about as often as always guessing \"up\", "
                   "so treat this as a weak signal.")
    return {"verdict": verdict, "strength": "Weak", "risk": risk, "reasons": reasons}


def _abs_pct(x):
    return f"{abs(x) * 100:.0f}%"


def long_term(stats, fund, price):
    """Four signals, each -1 / 0 / +1: trend, momentum, analysts (one combined signal, because
    analysts rate most large stocks a buy), valuation. Plus a falling-knife guard."""
    score, reasons = 0, []

    vs = stats.get("vs_ma200")
    if vs is not None:
        if vs > 0:
            score += 1
            reasons.append(f"Uptrend: price is {_abs_pct(vs)} above its 200-day average (${stats['ma200']:,.2f}).")
        else:
            score -= 1
            reasons.append(f"Downtrend: price is {_abs_pct(vs)} below its 200-day average (${stats['ma200']:,.2f}).")

    mom = stats.get("mom_12_1")
    if mom is not None:
        if mom > 0:
            score += 1
            reasons.append(f"Positive momentum: up {_abs_pct(mom)} over the past year, not counting the last month.")
        else:
            score -= 1
            reasons.append(f"Negative momentum: down {_abs_pct(mom)} over the past year, not counting the last month.")

    target, n = fund.get("targetMeanPrice"), fund.get("numberOfAnalystOpinions")
    rec = (fund.get("recommendationKey") or "").lower().replace("_", " ")
    if target:
        upside = target / price - 1
        bullish = rec in ("buy", "strong buy")
        if upside >= 0.15 and bullish:
            score += 1
            note = "That's a strong vote of confidence."
        elif upside < 0 or rec in ("hold", "sell", "strong sell", "underperform"):
            score -= 1
            note = "That's a cautious view, which is unusual: analysts rate most big companies a buy."
        else:
            note = "That's only mild support, since analysts rate most big companies a buy anyway."
        reasons.append(f"Analysts: average target ${target:,.2f}, {'up' if upside >= 0 else 'down'} {_abs_pct(upside)} "
                       f"from today" + (f", rated {rec}" if rec else "") + (f" by {n} analysts" if n else "")
                       + f". {note}")

    fpe = fund.get("forwardPE")
    if fpe and fpe > 0:
        if fpe > 35:
            score -= 1
            reasons.append(f"Expensive: about {fpe:.0f}x next year's expected earnings, so a lot of good news is already in the price.")
        elif fpe < 15:
            score += 1
            reasons.append(f"Cheap-looking: about {fpe:.0f}x next year's expected earnings.")
        else:
            reasons.append(f"Fairly valued: about {fpe:.0f}x next year's expected earnings.")

    verdict = "Buy" if score >= LONG_THRESHOLD else "Sell" if score <= -LONG_THRESHOLD else "Hold"
    falling = vs is not None and vs < 0 and (stats.get("from_high_52w") or 0) < -0.25
    if falling:
        reasons.append(f"It is {_abs_pct(stats['from_high_52w'])} below its 52-week high and still falling.")
        if verdict == "Buy":
            verdict = "Hold"
            reasons.append("Safety rule: a stock in a steep downtrend is capped at Hold until the trend turns, "
                           "however good it looks otherwise.")

    head = {"Buy": "Most long-term signals point up.", "Sell": "Most long-term signals point down.",
            "Hold": "The long-term signals are mixed."}[verdict]
    reasons.insert(0, f"{head} (score {score:+d} out of ±4)")
    reasons.append("These signals tend to work on average across many stocks, not reliably for one. "
                   "Owning a mix of stocks spreads the risk.")
    return {"verdict": verdict, "score": score, "strength": "Moderate" if abs(score) >= 3 else "Weak",
            "reasons": reasons}

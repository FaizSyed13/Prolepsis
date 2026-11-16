"""Turns a reasoned forecast into plain rows, shared by the website and the claude.ai page."""
from .config import NAMES


def forecast_rows(out, as_of):
    rows = []
    for tk, r in out.iterrows():
        changes = ([f"lean {'up' if r.lean > 0 else 'down'}"] if r.lean else []) + \
                  ([f"range x{r.vol_mult:g}"] if r.vol_mult != 1.0 else [])
        rows.append({
            "ticker": tk, "name": NAMES.get(tk, tk), "as_of": as_of,
            "price": round(float(r.price), 2),
            "up_pct": int(round(r.p_up_r * 100)), "down_pct": int(round((1 - r.p_up_r) * 100)),
            "model_up_pct": int(round(r.p_up * 100)),
            "low": round(float(r.low_r), 2), "high": round(float(r.high_r), 2),
            "model_low": round(float(r.low), 2), "model_high": round(float(r.high), 2),
            "lean": "up" if r.lean > 0 else "down" if r.lean < 0 else "none",
            "range_mult": float(r.vol_mult),
            "changed": ", ".join(changes), "event": r.event or "", "reason": r.reason or "",
        })
    return rows


def calibration_rows(rep):
    period = {"period_start": f"{rep['test_start']:%Y-%m-%d}", "period_end": f"{rep['test_end']:%Y-%m-%d}"}
    return [
        {"metric": "direction_accuracy", "label": "Up/down accuracy", "value": round(rep["accuracy"] * 100, 1), **period},
        {"metric": "naive_accuracy", "label": "Always guessing the common outcome", "value": round(rep["naive_accuracy"] * 100, 1), **period},
        {"metric": "range_coverage", "label": "80% range contained the outcome", "value": round(rep["range_coverage"] * 100, 1), **period},
        {"metric": "base_rate", "label": "Share of 5-day windows that went up", "value": round(rep["base_rate"] * 100, 1), **period},
    ]

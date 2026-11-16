"""Automatic reasoning from live headlines (FinBERT scores + key-word checks) and the real
earnings calendar -> lean and range adjustments.

These rules are a starting point and are NOT yet proven to help. Every forecast is logged and
graded (`python run.py grade`), so over time we can see whether they beat the plain model.

Per stock, over unique headlines from the last 3 days (newer ones count more, half-life 24h):
  headline score = FinBERT (P(positive) - P(negative)), pushed 0.4 towards bad/good when the
                   headline contains serious words (investigation, lawsuit, resigns, downgrade... /
                   upgrade, beats estimates, record high...). FinBERT alone underrates these.
  news score     = weighted average headline score, -1 (all bad) to +1 (all good)
  lean           = +1 at news score >= 0.25, +2 at >= 0.50 (same for negative); needs 3+ headlines
  range          = x1.5 if the company reports earnings within the next 7 days (Yahoo calendar),
                   x1.3 if 8+ headlines and 40%+ of them strongly worded (a flood of big news),
                   x1.6 if both
"""
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import pandas as pd

WINDOW_DAYS = 3
HALF_LIFE_H = 24
EARNINGS_DAYS = 7

SERIOUS_BAD = re.compile(
    r"\b(investigat\w*|probes?|probed|lawsuits?|sued|sues|fraud|resign\w*|ousted|fired|recalls?|recalled|"
    r"downgrad\w*|plung\w*|tumbl\w*|crash\w*|scandal\w*|subpoena\w*|antitrust|bankrupt\w*|misses|missed|"
    r"cuts? (?:its )?(?:guidance|outlook|forecast)|warns?|slump\w*|sell-?off|layoffs?)\b", re.I)
SERIOUS_GOOD = re.compile(
    r"\b(upgrad\w*|beats?|record high|all-time high|raises? (?:its )?(?:guidance|outlook|forecast|dividend)|"
    r"buybacks?|surg\w*|soar\w*|jumps?|rall(?:y|ies|ied)|approv\w*|comeback)\b", re.I)
FORWARD_EARNINGS = re.compile(
    r"\b(to report|ahead of (?:its |the )?(?:earnings|results|report)|earnings preview|results preview|"
    r"before (?:the )?earnings|earnings (?:on|this week|next week|tomorrow|today|date))\b", re.I)


def window_start(now=None):
    now = now or datetime.now(timezone.utc)
    return (now - timedelta(days=WINDOW_DAYS)).isoformat(timespec="seconds")


def headline_score(h):
    s = h["pos"] - h["neg"]
    kw = (1 if SERIOUS_GOOD.search(h["title"]) else 0) - (1 if SERIOUS_BAD.search(h["title"]) else 0)
    return max(-1.0, min(1.0, s + 0.4 * kw))


def tone(h):
    s = headline_score(h)
    return "good" if s >= 0.3 else "bad" if s <= -0.3 else "neutral"


def _norm(title):
    return re.sub(r"[^a-z0-9 ]", "", title.lower()).strip()


def unique(headlines):
    seen, out = set(), []
    for h in headlines:              # newest first, so the first copy of a story is kept
        key = (h["ticker"], _norm(h["title"]))
        if key not in seen:
            seen.add(key)
            out.append(h)
    return out


def _earnings_soon(iso, today):
    if not iso:
        return None
    d = date.fromisoformat(iso)
    return d if 0 <= (d - today).days <= EARNINGS_DAYS else None


def build_outlook(headlines, tickers, earnings=None, now=None):
    now = now or datetime.now(timezone.utc)
    earnings = earnings or {}
    by = defaultdict(list)
    for h in unique(headlines):
        by[h["ticker"]].append(h)

    rows, summary = [], {}
    for tk in tickers:
        hs = by.get(tk, [])
        cal = earnings.get(tk)                       # ISO date string or None (unknown)
        soon = _earnings_soon(cal, now.date())
        if soon is None and cal is None:             # calendar unknown: fall back to headlines
            soon = "soon" if sum(bool(FORWARD_EARNINGS.search(h["title"])) for h in hs) >= 2 else None

        n = len(hs)
        ss = [headline_score(h) for h in hs]
        if n:
            ws = [0.5 ** (max(0.0, (now - datetime.fromisoformat(h["published"])).total_seconds() / 3600) / HALF_LIFE_H)
                  for h in hs]
            net = sum(w * s for w, s in zip(ws, ss)) / sum(ws)
        else:
            net = 0.0
        counts = {t: sum(tone(h) == t for h in hs) for t in ("good", "bad", "neutral")}
        strong = (sum(abs(s) >= 0.6 for s in ss) / n) if n else 0.0

        lean = 0
        if n >= 3:
            lean = 2 if net >= 0.5 else 1 if net >= 0.25 else -2 if net <= -0.5 else -1 if net <= -0.25 else 0
        flood = n >= 8 and strong >= 0.4
        mult = 1.6 if (soon and flood) else 1.5 if soon else 1.3 if flood else 1.0
        if isinstance(soon, date):
            event = f"Earnings on {soon:%a %b} {soon.day}"
        elif soon:
            event = "Earnings expected soon"
        else:
            event = "Heavy news flow" if flood else ""

        if n:
            parts = [f"{n} headlines in the last 3 days: {counts['good']} good, {counts['bad']} bad, "
                     f"{counts['neutral']} neutral (news score {net:+.2f})."]
            parts.append(f"Mostly {'good' if lean > 0 else 'bad'} news, so a small {'up' if lean > 0 else 'down'} lean."
                         if lean else "No clear direction in the news, so no lean.")
        else:
            parts = ["No headlines found in the last 3 days."]
        if soon:
            parts.append("Earnings are due within the week, and prices usually move more around earnings.")
        if flood:
            parts.append("A lot of strongly worded news, so a bigger move than usual is likely.")
        rows.append({"ticker": tk, "lean": lean, "vol_mult": mult, "event": event, "reason": " ".join(parts)})
        summary[tk] = {"n": n, "score": round(net, 3), **counts, "earnings": cal}

    return pd.DataFrame(rows).set_index("ticker"), summary

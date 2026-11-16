"""Latest company headlines from Yahoo Finance (free, no key), plus news scores.

Workflow (scoring is done by Claude in Claude Code, covered by your subscription):
  1. python run.py news        -> saves the latest headlines to data/news_latest.csv
  2. ask Claude to score them   -> Claude writes data/news_scores.csv
  3. python run.py predict      -> shows the news score next to each forecast
"""
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf

SCORES_FILE = "news_scores.csv"     # columns: ticker, score (-2..+2), reason, scored_at
HEADLINES_FILE = "news_latest.csv"


def _items(ticker, count):
    t = yf.Ticker(ticker)
    try:
        return t.get_news(count=count)
    except Exception:
        return t.news or []


def fetch_headlines(cfg, per_ticker=12):
    rows = []
    for tk in cfg.tickers:
        for it in _items(tk, per_ticker):
            c = it.get("content") or it
            rows.append({
                "ticker": tk,
                "published": c.get("pubDate") or c.get("providerPublishTime"),
                "source": (c.get("provider") or {}).get("displayName", ""),
                "title": (c.get("title") or "").strip(),
                "summary": (c.get("summary") or "").strip()[:300],
                "url": ((c.get("canonicalUrl") or {}).get("url") or c.get("link") or ""),
            })
    df = pd.DataFrame(rows).drop_duplicates(["ticker", "title"])
    df = df[df["title"] != ""].sort_values(["ticker", "published"], ascending=[True, False])
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    df.to_csv(cfg.data_dir / HEADLINES_FILE, index=False, encoding="utf-8")
    return df


def load_scores(cfg, max_age_days=3):
    """News scores if they exist and are recent, else None."""
    path = cfg.data_dir / SCORES_FILE
    if not path.exists():
        return None
    s = pd.read_csv(path)
    scored = pd.to_datetime(s["scored_at"], utc=True).max()
    age = (datetime.now(timezone.utc) - scored).days
    return s.set_index("ticker").assign(age_days=age) if age <= max_age_days else None

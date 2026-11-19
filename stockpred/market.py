"""Whole-market picture for the "Today" page: index levels, futures, and market-wide headlines.

Reading only: none of this feeds the forecast model (market-wide features were tested on
2026-11-17 and made it worse).
"""
import re
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf

from .config import NAMES
from .live_news import _get, _parse_rss

# symbol, short name, what it is (plain words), how to show the change
MARKETS = [
    ("^GSPC", "S&P 500", "500 of the biggest US companies", "pct"),
    ("^IXIC", "Nasdaq", "mostly tech companies", "pct"),
    ("^DJI", "Dow Jones", "30 well-known US companies", "pct"),
    ("^RUT", "Russell 2000", "2,000 smaller US companies", "pct"),
    ("^VIX", "VIX (fear gauge)", "how nervous traders are; higher means more worried", "pct"),
    ("^TNX", "10-year yield", "interest rate on US government loans", "pts"),
    ("CL=F", "Oil", "US crude oil, per barrel", "pct"),
    ("GC=F", "Gold", "per ounce", "pct"),
    ("BTC-USD", "Bitcoin", "trades every day, even weekends", "pct"),
]
FUTURES = [("ES=F", "S&P 500 futures"), ("NQ=F", "Nasdaq futures"), ("YM=F", "Dow futures")]

# Free market-wide RSS feeds (checked 2026-11-18). Untrusted text: only scored and displayed.
MARKET_FEEDS = [
    ("https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", "CNBC"),
    ("https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069", "CNBC"),
    ("https://feeds.content.dowjones.io/public/rss/mw_topstories", "MarketWatch"),
    ("https://feeds.content.dowjones.io/public/rss/RSSMarketsMain", "WSJ"),
    ("https://www.investing.com/rss/news_25.rss", "Investing.com"),
    ("https://seekingalpha.com/market_currents.xml", "Seeking Alpha"),
    ("https://www.federalreserve.gov/feeds/press_all.xml", "Federal Reserve"),
    ("https://news.google.com/rss/search?q=stock+market+when:1d&hl=en-US&gl=US&ceid=US:en", "Google News"),
]
MARKET = "MARKET"   # ticker used to store market-wide headlines next to the stock ones

_NAME_RE = {tk: re.compile(r"\b(" + pat + r")\b") for tk, pat in {
    "AAPL": "Apple|iPhone", "MSFT": "Microsoft", "AMZN": "Amazon", "GOOGL": "Alphabet|Google",
    "META": "Meta|Facebook|Instagram", "NVDA": "Nvidia|NVIDIA", "JPM": "JPMorgan|JP Morgan",
    "JNJ": "Johnson & Johnson|J&J", "V": "Visa", "PG": "Procter & Gamble|P&G", "XOM": "Exxon",
    "UNH": "UnitedHealth", "HD": "Home Depot", "MA": "Mastercard", "KO": "Coca-Cola|Coke",
    "PEP": "PepsiCo|Pepsi", "MRK": "Merck", "CVX": "Chevron", "WMT": "Walmart", "COST": "Costco",
    "TSLA": "Tesla",
    "NFLX": "Netflix",
    "AMD": "AMD|Advanced Micro Devices",
    "AVGO": "Broadcom",
    "LLY": "Eli Lilly|Lilly",
    "BRK-B": "Berkshire",
    "ORCL": "Oracle",
    "CRM": "Salesforce",
    "ADBE": "Adobe",
    "DIS": "Disney",
    "BAC": "Bank of America|BofA",
    "INTC": "Intel",
    "PFE": "Pfizer",
    "NKE": "Nike",
    "MCD": "McDonald's|McDonald’s",
    "BA": "Boeing",
    "ABBV": "AbbVie",
    "CSCO": "Cisco",
    "QCOM": "Qualcomm",
    "UBER": "Uber",
}.items()}


def mentions(title):
    """Which of our stocks a market headline talks about (by company name)."""
    return [tk for tk, rx in _NAME_RE.items() if rx.search(title)]


def fetch_market_news():
    items, errors = [], []
    for url, name in MARKET_FEEDS:
        try:
            got = _parse_rss(_get(url), MARKET, name)
            for it in got:            # feeds that carry their own source tag (Google) keep it
                it["source"] = it["source"] if name == "Google News" else name
            items += got
        except Exception as e:
            errors.append(f"{name}: {type(e).__name__}")
    return items, errors


def _row(series, days):
    s = series.dropna()
    if len(s) < 2:
        return None
    last, prev = float(s.iloc[-1]), float(s.iloc[-2])
    return {"last": round(last, 4), "prev": round(prev, 4), "date": f"{s.index[-1]:%Y-%m-%d}",
            "chg_pct": round((last / prev - 1) * 100, 2), "chg_pts": round(last - prev, 4),
            "series": [[f"{d:%Y-%m-%d}", round(float(v), 4)] for d, v in s.tail(days).items()]}


def load_market(days=260):
    """Daily levels for the main markets plus overnight futures. Never raises: {} on failure."""
    syms = [m[0] for m in MARKETS] + [f[0] for f in FUTURES]
    try:
        raw = yf.download(syms, period="15mo", auto_adjust=True, progress=False, group_by="column")
        close = raw["Close"]
        close.index = pd.DatetimeIndex(close.index).tz_localize(None)
    except Exception as e:
        print(f"Market data failed: {type(e).__name__}: {e}")
        return {}
    out = {"markets": [], "futures": [], "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    for sym, name, what, unit in MARKETS:
        r = _row(close[sym], days) if sym in close else None
        if r:
            out["markets"].append({"symbol": sym, "name": name, "what": what, "unit": unit, **r})
    for sym, name in FUTURES:
        r = _row(close[sym], 5) if sym in close else None
        if r:
            r.pop("series")
            out["futures"].append({"symbol": sym, "name": name, **r})
    return out


def day_moves(close, tickers):
    """Each stock's change on the last trading day: {ticker: {"chg_pct", "date"}}."""
    out = {}
    for tk in tickers:
        s = close[tk].dropna() if tk in close else None
        if s is not None and len(s) >= 2:
            out[tk] = {"chg_pct": round((float(s.iloc[-1]) / float(s.iloc[-2]) - 1) * 100, 2),
                       "date": f"{s.index[-1]:%Y-%m-%d}", "name": NAMES.get(tk, tk)}
    return out

"""Live headlines from free RSS feeds (Google News, Bing News, Yahoo Finance, Seeking Alpha), stored in SQLite.

Google News aggregates outlets such as Reuters, CNBC, Bloomberg, WSJ, MarketWatch and Barron's.
Headlines are untrusted text: they are only scored and displayed, never executed.
"""
import hashlib
import html
import re
import sqlite3
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) stock-forecast/1.0"

# Search terms per ticker for Google News (company name is far more precise than the ticker).
QUERIES = {
    "AAPL": "Apple stock", "MSFT": "Microsoft stock", "AMZN": "Amazon stock",
    "GOOGL": "Alphabet Google stock", "META": "Meta Platforms stock", "NVDA": "Nvidia stock",
    "JPM": "JPMorgan stock", "JNJ": "Johnson & Johnson stock", "V": "Visa stock",
    "PG": "Procter & Gamble stock", "XOM": "Exxon Mobil stock", "UNH": "UnitedHealth stock",
    "HD": "Home Depot stock", "MA": "Mastercard stock", "KO": "Coca-Cola stock",
    "PEP": "PepsiCo stock", "MRK": "Merck stock", "CVX": "Chevron stock",
    "WMT": "Walmart stock", "COST": "Costco stock",
    "TSLA": "Tesla stock",
    "NFLX": "Netflix stock",
    "AMD": "AMD stock",
    "AVGO": "Broadcom stock",
    "LLY": "Eli Lilly stock",
    "BRK-B": "Berkshire Hathaway stock",
    "ORCL": "Oracle stock",
    "CRM": "Salesforce stock",
    "ADBE": "Adobe stock",
    "DIS": "Disney stock",
    "BAC": "Bank of America stock",
    "INTC": "Intel stock",
    "PFE": "Pfizer stock",
    "NKE": "Nike stock",
    "MCD": "McDonald's stock",
    "BA": "Boeing stock",
    "ABBV": "AbbVie stock",
    "CSCO": "Cisco stock",
    "QCOM": "Qualcomm stock",
    "UBER": "Uber stock",
}


def _get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _parse_rss(raw, ticker, default_source):
    out = []
    root = ET.fromstring(raw)
    for item in root.iter("item"):
        title = html.unescape((item.findtext("title") or "").strip())
        if not title:
            continue
        src_el = item.find("source")
        if src_el is None:            # Bing News puts the outlet in a namespaced <News:Source>
            src_el = next((c for c in item if c.tag.endswith("}Source")), None)
        source = (src_el.text or "").strip() if src_el is not None and src_el.text else default_source
        # Google News appends " - Outlet" to titles; strip it when it matches the source.
        if source and title.endswith(" - " + source):
            title = title[: -len(" - " + source)]
        raw_date = (item.findtext("pubDate") or "").strip()
        try:
            published = parsedate_to_datetime(raw_date).astimezone(timezone.utc)
        except Exception:
            try:   # some feeds (Investing.com) use "2026-11-19 03:05:36", in UTC
                d = datetime.fromisoformat(raw_date)
                published = (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
            except Exception:
                published = datetime.now(timezone.utc)
        link = (item.findtext("link") or "").strip()
        if "bing.com/news/apiclick" in link:     # Bing wraps the real article link in a redirect
            link = urllib.parse.parse_qs(urllib.parse.urlparse(link).query).get("url", [link])[0]
        out.append({
            "ticker": ticker, "title": re.sub(r"\s+", " ", title), "source": source or default_source,
            "url": link, "published": published.isoformat(timespec="seconds"),
        })
    return out


# Big wire services, asked for by name through Google News so their stories are not crowded out.
WIRES = "(site:reuters.com OR site:bloomberg.com OR site:apnews.com OR site:ft.com OR site:barrons.com)"


def fetch_ticker(ticker):
    items, errors = [], []
    name = QUERIES.get(ticker, ticker)
    q = urllib.parse.quote(f"{name} when:3d")
    wires = urllib.parse.quote(f'"{name.removesuffix(" stock")}" {WIRES} when:3d')
    sources = [   # (url, label, keep only headlines that name the company)
        (f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en", "Google News", False),
        (f"https://news.google.com/rss/search?q={wires}&hl=en-US&gl=US&ceid=US:en", "Google News", True),
        (f"https://www.bing.com/news/search?q={urllib.parse.quote(name)}&format=rss&mkt=en-us", "Bing News", True),
        (f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={ticker}&region=US&lang=en-US", "Yahoo Finance", False),
        (f"https://seekingalpha.com/api/sa/combined/{ticker.replace('-', '.')}.xml", "Seeking Alpha", False),
    ]
    from .market import _NAME_RE     # company-name patterns (imported here: market imports this module)
    named = _NAME_RE.get(ticker)
    for url, src, must_name in sources:
        try:
            got = _parse_rss(_get(url), ticker, src)
            if must_name and named is not None:
                got = [h for h in got if named.search(h["title"])]
            items += got
        except Exception as e:
            errors.append(f"{src}: {type(e).__name__}")
    return items, errors


class NewsStore:
    def __init__(self, path):
        self.path = path
        with self._db() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS headlines (
                id TEXT PRIMARY KEY, ticker TEXT, title TEXT, source TEXT, url TEXT,
                published TEXT, first_seen TEXT, pos REAL, neg REAL, neu REAL)""")

    def _db(self):
        return sqlite3.connect(self.path, timeout=30)

    @staticmethod
    def _id(ticker, title):
        return hashlib.sha1(f"{ticker}|{title.lower()}".encode("utf-8")).hexdigest()

    def add_new(self, items):
        """Insert unseen headlines; returns the new ones (still unscored)."""
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        new = []
        with self._db() as db:
            for it in items:
                hid = self._id(it["ticker"], it["title"])
                cur = db.execute("INSERT OR IGNORE INTO headlines (id, ticker, title, source, url, published, first_seen) "
                                 "VALUES (?,?,?,?,?,?,?)",
                                 (hid, it["ticker"], it["title"], it["source"], it["url"], it["published"], now))
                if cur.rowcount:
                    new.append({**it, "id": hid})
        return new

    def unscored(self):
        with self._db() as db:
            return [{"id": r[0], "title": r[1]} for r in
                    db.execute("SELECT id, title FROM headlines WHERE pos IS NULL")]

    def save_scores(self, scored):
        with self._db() as db:
            db.executemany("UPDATE headlines SET pos=?, neg=?, neu=? WHERE id=?",
                           [(s["pos"], s["neg"], s["neu"], s["id"]) for s in scored])

    def recent(self, since_iso):
        with self._db() as db:
            rows = db.execute("SELECT ticker, title, source, url, published, first_seen, pos, neg, neu "
                              "FROM headlines WHERE published >= ? AND pos IS NOT NULL "
                              "ORDER BY published DESC", (since_iso,)).fetchall()
        cols = ["ticker", "title", "source", "url", "published", "first_seen", "pos", "neg", "neu"]
        return [dict(zip(cols, r)) for r in rows]

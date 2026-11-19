"""Keeps the live forecast up to date for the website: prices, model and company facts a few
times a day, news every 15 minutes."""
import statistics
import threading
import traceback
from datetime import datetime, timedelta, timezone

import pandas as pd

from .advice import long_term, price_stats, short_term
from .auto_reason import build_outlook, headline_score, tone, unique, window_start
from .config import NAMES
from .data import candle_rows, load_prices
from .export import calibration_rows, forecast_rows
from .features import build_panel
from .fundamentals import load_fundamentals
from .live_news import NewsStore, fetch_ticker
from .market import MARKET, day_moves, fetch_market_news, load_market, mentions
from .probability import calibration_report, forecast_latest, oos_predictions
from .reasoning import apply_reasoning, load_outlook, log_forecast, track_record


def _now():
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.isoformat(timespec="seconds") if dt else None


def next_open(as_of):
    """Approximate next US market open after `as_of` (14:30 UTC on the next weekday)."""
    d = pd.Timestamp(as_of) + pd.offsets.BDay(1)
    return datetime(d.year, d.month, d.day, 14, 30, tzinfo=timezone.utc)


class ForecastService:
    def __init__(self, cfg, model="gboost"):
        self.cfg, self.model = cfg, model
        self.lock = threading.RLock()
        cfg.data_dir.mkdir(parents=True, exist_ok=True)
        self.store = NewsStore(cfg.data_dir / "news.db")
        self.base = self.rep = self.as_of = None
        self.stats, self.fund, self.candles, self.track = {}, {}, {}, None
        self.market, self.moves = {}, {}
        self.payload = None
        self.status = {"phase": "starting", "base_at": None, "news_at": None,
                       "news_new": 0, "news_errors": [], "error": None}

    # ---- slow: prices, model, company facts ----
    def refresh_base(self, refresh_prices=True):
        self._set(phase="Updating prices and the model")
        close, volume = load_prices(self.cfg, refresh_prices)
        panel, feature_cols, _ = build_panel(close, volume, self.cfg)
        oos = oos_predictions(panel, feature_cols, self.model, self.cfg)
        rep = calibration_report(oos)
        fc, last = forecast_latest(panel, feature_cols, self.model, self.cfg, oos)
        stats = {tk: price_stats(close, tk, self.cfg.benchmark) for tk in self.cfg.tickers}
        candles = candle_rows(self.cfg)
        moves = day_moves(close, list(self.cfg.tickers) + [self.cfg.benchmark])
        try:
            track = track_record(close, self.cfg)
        except Exception as e:
            print(f"Track record failed: {type(e).__name__}: {e}")
            track = None
        self._set(phase="Getting company facts")
        try:
            fund = load_fundamentals(self.cfg)
        except Exception as e:
            fund = self.fund or {}
            self._set(error=f"Company facts unavailable: {type(e).__name__}")
        with self.lock:
            self.base, self.rep, self.as_of, self.stats, self.fund = fc, rep, last, stats, fund
            self.candles, self.track = candles, track
            self.moves = moves
        self._set(base_at=_iso(_now()))

    # ---- fast: headlines + FinBERT ----
    def refresh_news(self):
        from .sentiment import score   # heavy import, loaded on first use
        self._set(phase="Checking the news")
        items, errors = [], []
        for tk in self.cfg.tickers:
            got, errs = fetch_ticker(tk)
            items += got
            errors += [f"{tk}: {e}" for e in errs]
        got, errs = fetch_market_news()
        items += got
        errors += [f"Market: {e}" for e in errs]
        new = self.store.add_new(items)
        pending = self.store.unscored()
        if pending:
            self._set(phase=f"Reading {len(pending)} new headlines")
            self.store.save_scores(score(pending))
        self._set(news_at=_iso(_now()), news_new=len(new), news_errors=errors[:10])

    # ---- quick: index levels and overnight futures for the Today page (reading only) ----
    def refresh_market(self):
        self._set(phase="Checking the markets")
        market = load_market()
        if market:
            with self.lock:
                self.market = market

    # ---- combine and publish to the page ----
    def rebuild(self):
        with self.lock:
            if self.base is None:
                return
            base, rep, as_of, stats, fund = self.base, self.rep, self.as_of, self.stats, self.fund
        everything = unique(self.store.recent(window_start()))
        headlines = [h for h in everything if h["ticker"] != MARKET]
        market_news = [{"title": h["title"], "source": h["source"], "url": h["url"], "published": h["published"],
                        "tone": tone(h), "score": round(headline_score(h), 3), "mentions": mentions(h["title"])}
                       for h in everything if h["ticker"] == MARKET][:120]
        earnings = {tk: (fund.get(tk) or {}).get("next_earnings") for tk in self.cfg.tickers}
        auto, summary = build_outlook(headlines, self.cfg.tickers, earnings)
        manual = load_outlook(self.cfg)            # Claude's own research, if recent, wins
        outlook = auto.copy()
        if manual is not None:
            for tk in manual.index.intersection(outlook.index):
                m = manual.loc[tk]
                auto_event = auto.loc[tk, "event"]
                event = auto_event if str(auto_event).startswith("Earnings on") else (m["event"] or auto_event)
                outlook.loc[tk, ["lean", "vol_mult", "event"]] = [m["lean"], max(m["vol_mult"], auto.loc[tk, "vol_mult"]), event]
                outlook.loc[tk, "reason"] = f"Claude's research: {m['reason']} News check: {auto.loc[tk, 'reason']}"
        out = apply_reasoning(base, outlook)

        if _now() < next_open(as_of):              # only log forecasts made before the next session
            log_forecast(out, as_of, self.cfg)

        as_of_s = f"{as_of:%Y-%m-%d}"
        rows = forecast_rows(out, as_of_s)
        base_pct = rep["base_rate"] * 100
        widths = [(r["high"] - r["low"]) / r["price"] * 100 for r in rows]
        med = statistics.median(widths)
        for r in rows:
            tk = r["ticker"]
            f = {k: v for k, v in (fund.get(tk) or {}).items() if k != "ticker"}
            r["news"] = summary.get(tk, {"n": 0, "score": 0.0})
            r["stats"], r["fund"] = stats.get(tk, {}), f
            r["advice"] = {"short": short_term(r, base_pct, med, r["news"]),
                           "long": long_term(r["stats"], f, r["price"])}
        news = [{"ticker": h["ticker"], "name": NAMES.get(h["ticker"], h["ticker"]), "title": h["title"],
                 "source": h["source"], "url": h["url"], "published": h["published"], "tone": tone(h),
                 "score": round(headline_score(h), 3)} for h in headlines[:300]]
        payload = {"forecast": rows, "calibration": calibration_rows(rep), "news": news, "candles": self.candles, "track": self.track,
                   "market": self.market, "moves": self.moves, "market_news": market_news,
                   "base_rate_pct": round(base_pct, 1),
                   "status": dict(self.status, phase="live", built_at=_iso(_now()))}
        with self.lock:
            self.payload = payload
        self._set(phase="live")

    def _set(self, **kw):
        with self.lock:
            self.status.update(kw)
            if self.payload:
                self.payload["status"] = dict(self.status)

    def run_forever(self, news_minutes=15, base_hours=6):
        last_base = None
        while True:
            try:
                if last_base is None or _now() - last_base > timedelta(hours=base_hours):
                    self.refresh_base(refresh_prices=True)
                    last_base = _now()
                    self.rebuild()
                self.refresh_news()
                self.refresh_market()
                self.rebuild()
                self._set(error=None)
            except Exception as e:
                traceback.print_exc()
                self._set(phase="live" if self.payload else "error", error=f"{type(e).__name__}: {e}")
            threading.Event().wait(news_minutes * 60)

"""Builds the public, once-a-day copy of the website into _site/ (used by GitHub Actions).

    python build_site.py

Same steps as the PC website (prices, model, company facts, news + FinBERT), run once,
saved as a static page plus state.json. No server needed.
"""
import json
import shutil
import warnings
from pathlib import Path

from stockpred.config import Config
from stockpred.service import ForecastService

warnings.filterwarnings("ignore", category=UserWarning)

ROOT = Path(__file__).resolve().parent
WEB, OUT = ROOT / "web", ROOT / "_site"


def main():
    svc = ForecastService(Config())
    svc.refresh_base(refresh_prices=True)
    try:
        svc.refresh_news()
    except Exception as e:   # page still builds from prices alone if the news step fails
        print(f"News step failed: {type(e).__name__}: {e}")
        svc._set(error=f"News unavailable today: {type(e).__name__}")
    svc.refresh_market()
    svc.rebuild()
    if not svc.payload:
        raise SystemExit("No forecast was built")
    if svc.status.get("news_errors"):
        print("News feed problems:", *svc.status["news_errors"], sep="\n  ")

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    for f in ("app.js", "trades.js", "style.css", "logo.svg"):
        shutil.copy(WEB / f, OUT / f)
    html = (WEB / "index.html").read_text(encoding="utf-8")
    html = html.replace('<script src="/static/trades.js"></script>', '<script src="trades.js"></script>')
    html = html.replace('href="/static/style.css"', 'href="style.css"')
    html = html.replace('/static/logo.svg', 'logo.svg')
    html = html.replace('<script src="/static/app.js"></script>',
                        '<script>window.STATE_URL = "state.json";</script>\n<script src="app.js"></script>')
    html = html.replace("Checked every 15 minutes. Each headline is rated by FinBERT, a finance news model running on this PC.",
                        "Checked twice each weekday (early morning and evening). Each headline is rated by FinBERT, a free finance news model.")
    (OUT / "index.html").write_text(html, encoding="utf-8")
    (OUT / "state.json").write_text(json.dumps(svc.payload, default=str), encoding="utf-8")
    (OUT / ".nojekyll").write_text("", encoding="utf-8")
    p = svc.payload
    print(f"Built {OUT}: {len(p['forecast'])} stocks, {len(p['news'])} headlines, "
          f"prices as of {p['forecast'][0]['as_of']}")


if __name__ == "__main__":
    main()

"""Prolepsis (Weekly Stock Forecast) website. Runs on this PC only (http://127.0.0.1:8050).

    Double-click "Start Stock Forecast.bat", or run:  .venv\\Scripts\\python app.py
"""
import os
import threading
import warnings
import webbrowser
from pathlib import Path

from flask import Flask, jsonify, send_from_directory

from stockpred.config import Config
from stockpred.service import ForecastService

warnings.filterwarnings("ignore", category=UserWarning)

WEB = Path(__file__).resolve().parent / "web"
PORT = 8050

app = Flask(__name__, static_folder=str(WEB), static_url_path="/static")
svc = ForecastService(Config())


@app.get("/")
def index():
    return send_from_directory(WEB, "index.html")


@app.get("/api/state")
def state():
    with svc.lock:
        if svc.payload:
            return jsonify(svc.payload)
        return jsonify({"status": dict(svc.status)})


if __name__ == "__main__":
    threading.Thread(target=svc.load_public, daemon=True).start()   # shows forecasts within seconds
    threading.Thread(target=svc.run_forever, daemon=True).start()
    if not os.environ.get("NO_BROWSER"):
        threading.Timer(1.5, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}")).start()
    print(f"Stock Forecast is running at http://127.0.0.1:{PORT}  (close this window to stop it)")
    app.run(host="127.0.0.1", port=PORT, debug=False, use_reloader=False)

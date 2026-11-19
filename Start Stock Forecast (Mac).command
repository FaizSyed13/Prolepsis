#!/bin/bash
# Stock Forecast for Mac: double-click to start. The first time, it sets up a private copy of
# Python inside this folder (nothing is installed on the Mac). Close this window to stop the app.
cd "$(dirname "$0")" || exit 1

PY="python/bin/python3"
# Portable Python build (python-build-standalone, the same builds the "uv" tool uses).
TAG="20261026"
VER="3.12.16"

fail() {
    echo
    echo "Setup did not finish. Check your internet connection, then double-click"
    echo "\"Start Stock Forecast (Mac)\" again to retry."
    rm -rf python
    read -r -p "Press Return to close."
    exit 1
}

if [ -x ".venv/bin/python" ]; then
    PY=".venv/bin/python"                     # developer's own setup, if there is one
elif [ ! -f "python/ready.txt" ]; then
    echo "============================================================"
    echo " First-time setup. This happens only once."
    echo " It downloads a private copy of Python and the add-ons this"
    echo " app needs (about 0.5 GB) into the \"python\" folder here."
    echo " Nothing is installed on your Mac. To remove everything,"
    echo " just delete this whole folder."
    echo " This can take 5-15 minutes depending on your internet."
    echo "============================================================"
    echo
    # The news AI engine (onnxruntime) only supports Apple-chip Macs on macOS 14 or newer.
    MACOS="$(sw_vers -productVersion | cut -d. -f1)"
    if [ "$(uname -m)" != "arm64" ] || [ "${MACOS:-0}" -lt 14 ]; then
        echo "Sorry, this needs a Mac with an Apple chip (M1 or newer) and macOS 14 Sonoma or newer."
        echo "You can still see the forecasts here: https://faizsyed13.github.io/Prolepsis---Future-of-stock-forecasting/"
        read -r -p "Press Return to close."
        exit 1
    fi
    URL="https://github.com/astral-sh/python-build-standalone/releases/download/${TAG}/cpython-${VER}%2B${TAG}-aarch64-apple-darwin-install_only.tar.gz"
    rm -rf python
    echo "[1/3] Downloading Python..."
    curl -L --fail --progress-bar -o py.tar.gz "$URL" || fail
    tar -xzf py.tar.gz || fail                # unpacks into ./python
    rm -f py.tar.gz
    echo "[2/3] Installing add-ons (the slow part)..."
    "$PY" -m pip install --disable-pip-version-check -q -r requirements.txt || fail
    echo "[3/3] Done."
    echo ok > python/ready.txt
    echo
fi

echo "Starting Stock Forecast... your browser will open in a moment."
echo "The very first start also downloads prices, news and the news AI model,"
echo "so the page may say \"loading\" for several minutes. Later starts are faster."
echo "Keep this window open while you use the website. Close it to stop."
echo
"$PY" app.py

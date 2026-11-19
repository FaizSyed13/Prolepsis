#!/bin/bash
# Stock Forecast for Mac: double-click to start. The first time, it sets up a private copy of
# Python inside this folder (nothing is installed on the Mac). Close this window to stop the app.
cd "$(dirname "$0")" || exit 1

PY="python/bin/python3"
# Portable Python build (python-build-standalone, the same builds the "uv" tool uses).
TAG="20261026"
VER="3.12.16"
# Fast add-on installer (uv), pinned version.
UV_VER="0.13.6"

fail() {
    echo
    echo "Setup did not finish. Check your internet connection, then double-click"
    echo "\"Start Stock Forecast (Mac)\" again to retry."
    rm -rf python py.tar.gz uv.tar.gz
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
    echo " This usually takes 2-5 minutes depending on your internet."
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
    echo "[2/3] Downloading the fast add-on installer (uv)..."
    curl -L --fail --progress-bar -o uv.tar.gz "https://github.com/astral-sh/uv/releases/download/${UV_VER}/uv-aarch64-apple-darwin.tar.gz" || fail
    tar -xzf uv.tar.gz -C python --strip-components=1 "uv-aarch64-apple-darwin/uv" || fail
    rm -f uv.tar.gz
    echo "[3/3] Installing add-ons..."
    # Keep uv's download cache inside this folder too, and remove it when done.
    UV_CACHE_DIR="$PWD/python/uv-cache" python/uv pip install --python "$PY" -r requirements.txt || fail
    rm -rf python/uv-cache
    echo "Done."
    echo ok > python/ready.txt
    echo
fi

echo "Starting Stock Forecast... your browser will open in a moment."
echo "Right away the page shows today's forecast from the public website, while"
echo "this computer makes its own (the first time takes about 15-30 minutes)."
echo "Keep this window open while you use the website. Close it to stop."
echo
"$PY" app.py

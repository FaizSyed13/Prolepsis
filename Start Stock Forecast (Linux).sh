#!/bin/bash
# Stock Forecast for Linux. Start it from a terminal in this folder with:
#     bash "Start Stock Forecast (Linux).sh"
# The first time, it sets up a private copy of Python inside this folder (nothing is installed
# on the system, no sudo needed). Press Ctrl+C or close the terminal to stop the app.
cd "$(dirname "$0")" || exit 1

PY="python/bin/python3"
# Portable Python build (python-build-standalone, the same builds the "uv" tool uses).
TAG="20261026"
VER="3.12.16"
# Fast add-on installer (uv), pinned version.
UV_VER="0.13.6"

fail() {
    echo
    echo "Setup did not finish. Check your internet connection, then run this file again to retry."
    rm -rf python py.tar.gz uv.tar.gz
    exit 1
}

download() {  # download URL FILE, with curl or wget (whichever the system has)
    if command -v curl >/dev/null 2>&1; then
        curl -L --fail --progress-bar -o "$2" "$1"
    elif command -v wget >/dev/null 2>&1; then
        wget -q --show-progress -O "$2" "$1"
    else
        echo "Please install curl or wget first (for example: sudo apt install curl)."
        return 1
    fi
}

if [ -x ".venv/bin/python" ]; then
    PY=".venv/bin/python"                     # developer's own setup, if there is one
elif [ ! -f "python/ready.txt" ]; then
    echo "============================================================"
    echo " First-time setup. This happens only once."
    echo " It downloads a private copy of Python and the add-ons this"
    echo " app needs (about 0.5 GB) into the \"python\" folder here."
    echo " Nothing is installed on your system. To remove everything,"
    echo " just delete this whole folder."
    echo " This usually takes 2-5 minutes depending on your internet."
    echo "============================================================"
    echo
    case "$(uname -m)" in
        x86_64|amd64)  ARCH="x86_64" ;;
        aarch64|arm64) ARCH="aarch64" ;;
        *) ARCH="" ;;
    esac
    # The portable Python and the news AI engine need a normal (glibc) Linux on a 64-bit
    # Intel/AMD or ARM processor. Alpine (musl) and 32-bit systems are not supported.
    if [ -z "$ARCH" ] || ! ldd --version 2>&1 | grep -qiE "glibc|gnu libc"; then
        echo "Sorry, this needs 64-bit Linux (Intel/AMD or ARM) with standard glibc,"
        echo "for example Ubuntu, Debian, Fedora, Mint or Arch."
        echo "You can still see the forecasts here: https://faizsyed13.github.io/Prolepsis---Future-of-stock-forecasting/"
        exit 1
    fi
    URL="https://github.com/astral-sh/python-build-standalone/releases/download/${TAG}/cpython-${VER}%2B${TAG}-${ARCH}-unknown-linux-gnu-install_only.tar.gz"
    rm -rf python
    echo "[1/3] Downloading Python..."
    download "$URL" py.tar.gz || fail
    tar -xzf py.tar.gz || fail                # unpacks into ./python
    rm -f py.tar.gz
    echo "[2/3] Downloading the fast add-on installer (uv)..."
    download "https://github.com/astral-sh/uv/releases/download/${UV_VER}/uv-${ARCH}-unknown-linux-gnu.tar.gz" uv.tar.gz || fail
    tar -xzf uv.tar.gz -C python --strip-components=1 "uv-${ARCH}-unknown-linux-gnu/uv" || fail
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
echo "If it does not, open http://127.0.0.1:8050 yourself."
echo "Right away the page shows today's forecast from the public website, while"
echo "this computer makes its own (the first time takes about 15-30 minutes)."
echo "Keep this terminal open while you use the website. Press Ctrl+C to stop."
echo
exec "$PY" app.py

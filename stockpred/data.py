import pandas as pd
import yfinance as yf

FIELDS = {"open": "Open", "high": "High", "low": "Low", "close": "Close", "volume": "Volume"}


def load_prices(cfg, refresh=False):
    """Daily split/dividend-adjusted prices, cached locally. Returns (close, volume).
    The cache also keeps open/high/low for the candlestick charts (see load_ohlc)."""
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    path = cfg.data_dir / "prices.pkl"
    wanted = set(cfg.tickers) | {cfg.benchmark}

    if path.exists() and not refresh:
        cached = pd.read_pickle(path)
        if wanted <= set(cached["close"].columns):
            return cached["close"], cached["volume"]

    print(f"Downloading {len(wanted)} tickers from Yahoo Finance...")
    raw = yf.download(sorted(wanted), start=cfg.start, auto_adjust=True,
                      progress=False, group_by="column")
    if raw.empty:
        raise RuntimeError("Download returned no data. Check your internet connection.")

    close = raw["Close"].dropna(how="all")
    frames = {k: raw[v].reindex(close.index) for k, v in FIELDS.items()}
    missing = wanted - set(close.columns[close.notna().any()])
    if missing:
        raise RuntimeError(f"No data for: {sorted(missing)}")

    for df in frames.values():
        df.index = pd.DatetimeIndex(df.index).tz_localize(None)
        df.index.name, df.columns.name = "date", "ticker"

    pd.to_pickle(frames, path)
    return frames["close"], frames["volume"]


def load_ohlc(cfg):
    """Cached open/high/low/close frames, or None if the cache predates candlesticks."""
    path = cfg.data_dir / "prices.pkl"
    if not path.exists():
        return None
    cached = pd.read_pickle(path)
    if not {"open", "high", "low", "close"} <= set(cached):
        return None
    return {k: cached[k] for k in ("open", "high", "low", "close")}


def candle_rows(cfg, days=126):
    """Last `days` trading days of daily candles for each stock: {ticker: [[date, o, h, l, c], ...]}."""
    ohlc = load_ohlc(cfg)
    if ohlc is None:
        return {}
    out = {}
    for tk in cfg.tickers:
        df = pd.DataFrame({k: v[tk] for k, v in ohlc.items()}).dropna().tail(days)
        out[tk] = [[f"{d:%Y-%m-%d}", *(round(float(x), 2) for x in r)]
                   for d, r in zip(df.index, df[["open", "high", "low", "close"]].values)]
    return out

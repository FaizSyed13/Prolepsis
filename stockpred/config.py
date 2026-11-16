from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

NAMES = {
    "AAPL": "Apple", "MSFT": "Microsoft", "AMZN": "Amazon", "GOOGL": "Alphabet/Google",
    "META": "Meta", "NVDA": "Nvidia", "JPM": "JPMorgan Chase", "JNJ": "Johnson & Johnson",
    "V": "Visa", "PG": "Procter & Gamble", "XOM": "Exxon Mobil", "UNH": "UnitedHealth",
    "HD": "Home Depot", "MA": "Mastercard", "KO": "Coca-Cola", "PEP": "PepsiCo",
    "MRK": "Merck", "CVX": "Chevron", "WMT": "Walmart", "COST": "Costco", "SPY": "S&P 500 ETF",
}


@dataclass
class Config:
    # Universe: 20 large US stocks. NOTE: picked with today's hindsight -> survivorship bias.
    tickers: list = field(default_factory=lambda: [
        "AAPL", "MSFT", "AMZN", "GOOGL", "META", "NVDA", "JPM", "JNJ", "V", "PG",
        "XOM", "UNH", "HD", "MA", "KO", "PEP", "MRK", "CVX", "WMT", "COST",
    ])
    benchmark: str = "SPY"
    start: str = "2010-01-01"

    horizon: int = 5            # predict: will the stock beat SPY over the next N trading days?
    retrain_every: int = 63     # walk-forward: retrain roughly every quarter
    min_train_days: int = 756   # ~3 years of history before the first out-of-sample prediction

    top_k: int = 5              # strategy: hold the top-k scored stocks, equal weight
    cost_bps: float = 10.0      # trading cost + slippage per unit of turnover, in basis points

    seed: int = 42
    data_dir: Path = ROOT / "data"
    reports_dir: Path = ROOT / "reports"

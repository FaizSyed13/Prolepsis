from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

NAMES = {
    "AAPL": "Apple", "MSFT": "Microsoft", "AMZN": "Amazon", "GOOGL": "Alphabet/Google",
    "META": "Meta", "NVDA": "Nvidia", "JPM": "JPMorgan Chase", "JNJ": "Johnson & Johnson",
    "V": "Visa", "PG": "Procter & Gamble", "XOM": "Exxon Mobil", "UNH": "UnitedHealth",
    "HD": "Home Depot", "MA": "Mastercard", "KO": "Coca-Cola", "PEP": "PepsiCo",
    "MRK": "Merck", "CVX": "Chevron", "WMT": "Walmart", "COST": "Costco",
    "TSLA": "Tesla", "NFLX": "Netflix", "AMD": "AMD", "AVGO": "Broadcom", "LLY": "Eli Lilly", "BRK-B": "Berkshire Hathaway", "ORCL": "Oracle", "CRM": "Salesforce", "ADBE": "Adobe", "DIS": "Disney", "BAC": "Bank of America", "INTC": "Intel", "PFE": "Pfizer", "NKE": "Nike", "MCD": "McDonald's", "BA": "Boeing", "ABBV": "AbbVie", "CSCO": "Cisco", "QCOM": "Qualcomm", "UBER": "Uber",
    "SPY": "S&P 500 ETF",
}


@dataclass
class Config:
    # Universe: 40 large US stocks (20 original + 20 popular names added 2026-11-18). NOTE: picked with today's hindsight -> survivorship bias.
    tickers: list = field(default_factory=lambda: [
        "AAPL", "MSFT", "AMZN", "GOOGL", "META", "NVDA", "JPM", "JNJ", "V", "PG",
        "XOM", "UNH", "HD", "MA", "KO", "PEP", "MRK", "CVX", "WMT", "COST",
        "TSLA", "NFLX", "AMD", "AVGO", "LLY", "BRK-B", "ORCL", "CRM", "ADBE", "DIS", "BAC", "INTC", "PFE", "NKE", "MCD", "BA", "ABBV", "CSCO", "QCOM", "UBER",
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

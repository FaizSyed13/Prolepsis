"""FinBERT headline sentiment (ProsusAI/finbert), run locally on the CPU. Free, no key.

The model (~440 MB) downloads from Hugging Face on first use and is cached afterwards.
"""
import threading

MODEL = "ProsusAI/finbert"
_lock = threading.Lock()
_pipe = None


def _pipeline():
    global _pipe
    with _lock:
        if _pipe is None:
            from transformers import pipeline
            _pipe = pipeline("text-classification", model=MODEL, top_k=None, truncation=True)
    return _pipe


def score(items, batch_size=32):
    """items: [{"id", "title"}] -> [{"id", "pos", "neg", "neu"}]"""
    if not items:
        return []
    results = _pipeline()([it["title"] for it in items], batch_size=batch_size)
    out = []
    for it, res in zip(items, results):
        p = {r["label"].lower(): float(r["score"]) for r in res}
        out.append({"id": it["id"], "pos": p.get("positive", 0.0),
                    "neg": p.get("negative", 0.0), "neu": p.get("neutral", 0.0)})
    return out

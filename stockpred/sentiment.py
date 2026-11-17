"""FinBERT headline sentiment (ProsusAI/finbert), run locally on the CPU. Free, no key.

Uses a half-size (16-bit) ONNX copy of the same model (Xenova/finbert, ~220 MB) run by
ONNX Runtime, instead of the full model + PyTorch (~0.9 GB together). Scores match the
original (tested on 2,047 headlines: same label for all, max score change 0.003).
Files download from Hugging Face on first use and are cached afterwards. (The 8-bit copy was tested too and rejected: 17% of labels changed.)
"""
import json
import threading

import numpy as np

REPO = "Xenova/finbert"                                  # ONNX export of ProsusAI/finbert
REVISION = "8f269abebfdd9009d7d9b5e96af7e5c6bfe50b20"    # pinned so upstream changes can't alter scores
MODEL_FILE = "onnx/model_fp16.onnx"                     # half-size; same results as the original
MAX_TOKENS = 512

_lock = threading.Lock()
_model = None


def _load():
    global _model
    with _lock:
        if _model is None:
            import onnxruntime as ort
            from huggingface_hub import hf_hub_download
            from tokenizers import Tokenizer

            get = lambda f: hf_hub_download(REPO, f, revision=REVISION)
            tok = Tokenizer.from_file(get("tokenizer.json"))
            tok.enable_truncation(MAX_TOKENS)
            tok.enable_padding(pad_id=tok.token_to_id("[PAD]"), pad_token="[PAD]")
            labels = json.load(open(get("config.json"), encoding="utf-8"))["id2label"]
            labels = [labels[str(i)].lower() for i in range(len(labels))]
            opts = ort.SessionOptions()
            opts.log_severity_level = 3
            sess = ort.InferenceSession(get(MODEL_FILE), opts, providers=["CPUExecutionProvider"])
            _model = (tok, sess, labels, {i.name for i in sess.get_inputs()})
    return _model


def _probs(titles):
    tok, sess, labels, names = _load()
    enc = tok.encode_batch(titles)
    feed = {"input_ids": np.array([e.ids for e in enc], dtype=np.int64),
            "attention_mask": np.array([e.attention_mask for e in enc], dtype=np.int64),
            "token_type_ids": np.array([e.type_ids for e in enc], dtype=np.int64)}
    logits = sess.run(None, {k: v for k, v in feed.items() if k in names})[0]
    e = np.exp(logits - logits.max(axis=1, keepdims=True))
    return labels, e / e.sum(axis=1, keepdims=True)


def score(items, batch_size=32):
    """items: [{"id", "title"}] -> [{"id", "pos", "neg", "neu"}]"""
    out = []
    for i in range(0, len(items), batch_size):
        chunk = items[i:i + batch_size]
        labels, probs = _probs([it["title"] for it in chunk])
        for it, row in zip(chunk, probs):
            p = dict(zip(labels, map(float, row)))
            out.append({"id": it["id"], "pos": p.get("positive", 0.0),
                        "neg": p.get("negative", 0.0), "neu": p.get("neutral", 0.0)})
    return out

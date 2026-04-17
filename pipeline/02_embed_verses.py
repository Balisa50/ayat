"""
Embed all 6,236 verses using sentence-transformers.
Embeds the English translation (faster, better semantic coverage for mixed queries).
Saves a numpy array to data/embeddings.npy (shape: 6236 x 384).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

HERE = Path(__file__).parent
DATA = HERE / "data"

MODEL_NAME = "all-MiniLM-L6-v2"  # 384-dim, ~80MB, fast on CPU


def main() -> None:
    verses = json.loads((DATA / "raw_verses.json").read_text(encoding="utf-8"))
    print(f"Loaded {len(verses)} verses.")

    print(f"Loading model {MODEL_NAME}...")
    model = SentenceTransformer(MODEL_NAME)

    texts = [v["translation"] for v in verses]
    print("Embedding verses...")
    embeddings = model.encode(texts, show_progress_bar=True, batch_size=64, normalize_embeddings=True)
    embeddings = np.asarray(embeddings, dtype=np.float32)
    print(f"Embeddings shape: {embeddings.shape}")

    out = DATA / "embeddings.npy"
    np.save(out, embeddings)
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()

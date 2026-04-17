"""
Reduce 384-dim embeddings to 3D coords using UMAP, and cluster using HDBSCAN.
Writes data/verses_with_coords.json.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import umap
import hdbscan

HERE = Path(__file__).parent
DATA = HERE / "data"


def main() -> None:
    verses = json.loads((DATA / "raw_verses.json").read_text(encoding="utf-8"))
    embeddings = np.load(DATA / "embeddings.npy")
    print(f"Verses: {len(verses)}, Embeddings: {embeddings.shape}")

    print("UMAP to 3D...")
    reducer3 = umap.UMAP(
        n_components=3,
        n_neighbors=15,
        min_dist=0.1,
        metric="cosine",
        random_state=42,
    )
    coords3 = reducer3.fit_transform(embeddings)

    # Normalize coords to [-1, 1]^3 so the frontend can scale consistently
    for axis in range(3):
        col = coords3[:, axis]
        lo, hi = col.min(), col.max()
        coords3[:, axis] = 2.0 * (col - lo) / (hi - lo) - 1.0

    print("HDBSCAN clustering...")
    clusterer = hdbscan.HDBSCAN(min_cluster_size=30, metric="euclidean")
    clusters = clusterer.fit_predict(embeddings.astype(np.float64))
    print(f"Found {len(set(clusters)) - (1 if -1 in clusters else 0)} clusters "
          f"({(clusters == -1).sum()} noise points)")

    for i, v in enumerate(verses):
        v["x"] = float(coords3[i, 0])
        v["y"] = float(coords3[i, 1])
        v["z"] = float(coords3[i, 2])
        v["cluster"] = int(clusters[i])

    out = DATA / "verses_with_coords.json"
    out.write_text(json.dumps(verses, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()

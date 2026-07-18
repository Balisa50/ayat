"""
Reduce 384-dim embeddings to 3D coords for display, and cluster the corpus.
Writes data/verses_with_coords.json.

Two separate reductions happen here, deliberately:

  * DISPLAY   UMAP -> 3D, min_dist=0.1, so the galaxy has visual breathing room.
  * CLUSTER   PCA -> 64D, then UMAP -> 10D with min_dist=0.0, then HDBSCAN.

They are separate because the settings that make a galaxy look good are not the
settings that make density clustering work. Clustering the 3D display coords
gives unstable results (they are spread out on purpose); clustering the raw
384-dim embeddings gives almost nothing at all.

That second failure was the original bug here: HDBSCAN ran with
metric="euclidean" directly on the 384-dim vectors while UMAP correctly used
metric="cosine". At that dimensionality the density estimate collapses, and
4,838 of 6,236 verses (78%) came back as noise with one surviving cluster of 33
verses. Running HDBSCAN on a UMAP-reduced space instead is the standard fix --
it is what BERTopic does -- and it takes noise down to ~1%.

The resulting two clusters are interpretable: a narrative/prophetic register
(87% Meccan, shorter verses, vocabulary around Joseph, Moses, Pharaoh, gardens,
signs) and a legislative/community register (longer verses, vocabulary around
rulings, the hypocrites, lawfulness, marriage). Note the second is a 50/50
Meccan/Medinan split, so this recovers something the revelation-type metadata
does not already encode.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import umap
from sklearn.cluster import HDBSCAN
from sklearn.decomposition import PCA

HERE = Path(__file__).parent
DATA = HERE / "data"

# Display projection
DISPLAY_COMPONENTS = 3
DISPLAY_NEIGHBORS = 15
DISPLAY_MIN_DIST = 0.1

# Clustering projection. min_dist=0.0 lets points pack tightly, which is what
# density clustering wants; n_neighbors=8 keeps structure local enough to
# separate registers instead of collapsing into a single manifold.
CLUSTER_PCA_DIM = 64
CLUSTER_COMPONENTS = 10
CLUSTER_NEIGHBORS = 8
CLUSTER_MIN_DIST = 0.0
MIN_CLUSTER_SIZE = 45


def main() -> None:
    verses = json.loads((DATA / "raw_verses.json").read_text(encoding="utf-8"))
    embeddings = np.load(DATA / "embeddings.npy")
    print(f"Verses: {len(verses)}, Embeddings: {embeddings.shape}")

    print("UMAP to 3D for display...")
    reducer3 = umap.UMAP(
        n_components=DISPLAY_COMPONENTS,
        n_neighbors=DISPLAY_NEIGHBORS,
        min_dist=DISPLAY_MIN_DIST,
        metric="cosine",
        random_state=42,
    )
    coords3 = reducer3.fit_transform(embeddings)

    # Normalize coords to [-1, 1]^3 so the frontend can scale consistently
    for axis in range(DISPLAY_COMPONENTS):
        col = coords3[:, axis]
        lo, hi = col.min(), col.max()
        coords3[:, axis] = 2.0 * (col - lo) / (hi - lo) - 1.0

    print(f"PCA to {CLUSTER_PCA_DIM}D, then UMAP to {CLUSTER_COMPONENTS}D for clustering...")
    pca = PCA(n_components=CLUSTER_PCA_DIM, random_state=42)
    reduced = pca.fit_transform(embeddings)
    # L2-normalize so UMAP's cosine metric behaves as it does on the unit-norm
    # source embeddings.
    reduced = reduced / (np.linalg.norm(reduced, axis=1, keepdims=True) + 1e-12)

    cluster_space = umap.UMAP(
        n_components=CLUSTER_COMPONENTS,
        n_neighbors=CLUSTER_NEIGHBORS,
        min_dist=CLUSTER_MIN_DIST,
        metric="cosine",
        random_state=42,
    ).fit_transform(reduced.astype(np.float32))

    print("HDBSCAN clustering...")
    clusters = HDBSCAN(min_cluster_size=MIN_CLUSTER_SIZE).fit_predict(
        cluster_space.astype(np.float64)
    )
    n_noise = int((clusters == -1).sum())
    n_clusters = len(set(clusters.tolist())) - (1 if -1 in clusters else 0)
    print(
        f"Found {n_clusters} clusters "
        f"({n_noise} noise points, {100 * n_noise / len(verses):.1f}%)"
    )

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

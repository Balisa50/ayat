"""
Build semantic neighbour lists and the client-side search artefacts.
Writes public/data/verses.json, embeddings.i8 and pca.bin.

Three representations of the same corpus ship, because they do different jobs:

  verses.json "e"   PCA-64, unit-norm. Cheap geometry. Good for *ranking*
                    relative to a centroid, and for the O(N*D^2) projection
                    maths the galaxy layout needs. Kept for the existing
                    search path and for query-conditioned reprojection.

  embeddings.i8     Full 384-dim, int8-quantised (2.4 MB vs 9.6 MB float32).
                    Needed because PCA-64 destroys *absolute* similarity
                    calibration: measured over 20 off-topic and 10 on-topic
                    queries, top-10 mean cosine separates them with AUC 1.000
                    in 384-dim and AUC 0.480 (i.e. no signal at all) in PCA-64.
                    Projecting into a 64-dim subspace and renormalising
                    inflates whatever little survived, so unrelated queries
                    score as high as relevant ones. Quantisation is nearly
                    free here: mean cosine fidelity 0.999, top-20 ranking
                    agreement 97%.

  pca.bin           The PCA basis (mean + components), so the browser can
                    project a freshly embedded query into the same 64-dim
                    space "e" lives in. Only needed for the geometry path.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sklearn.decomposition import PCA

HERE = Path(__file__).parent
DATA = HERE / "data"
PUBLIC_DATA = HERE.parent / "public" / "data"
PUBLIC_DATA.mkdir(parents=True, exist_ok=True)

TOP_K_NEIGHBORS = 5
PCA_DIM = 64
EMBED_DIM = 384  # all-MiniLM-L6-v2 output width
INT8_SCALE = 127.0


def main() -> None:
    verses = json.loads((DATA / "verses_with_coords.json").read_text(encoding="utf-8"))
    embeddings = np.load(DATA / "embeddings.npy")  # already normalized
    N = len(verses)
    print(f"Building graph for {N} verses...")

    print("Computing top-k neighbors via cosine similarity...")
    # Since embeddings are L2-normalized, cosine = dot product
    sims = embeddings @ embeddings.T
    np.fill_diagonal(sims, -1.0)
    top_idx = np.argpartition(-sims, TOP_K_NEIGHBORS, axis=1)[:, :TOP_K_NEIGHBORS]

    print(f"PCA to {PCA_DIM} dimensions for client-side search...")
    pca = PCA(n_components=PCA_DIM, random_state=42)
    pca_emb = pca.fit_transform(embeddings)
    # Normalize so client can use dot product as cosine
    norms = np.linalg.norm(pca_emb, axis=1, keepdims=True) + 1e-12
    pca_emb = pca_emb / norms
    # Round to 3 decimal places to shrink JSON size
    pca_emb = np.round(pca_emb, 3)

    for i, v in enumerate(verses):
        # Convert ids to 1-indexed verse ids (matching v["id"])
        neighbors = top_idx[i].tolist()
        # Sort by similarity desc
        neighbors.sort(key=lambda j: -sims[i, j])
        v["neighbors"] = [int(verses[j]["id"]) for j in neighbors]
        v["e"] = pca_emb[i].tolist()  # short key to save space

    out = PUBLIC_DATA / "verses.json"
    out.write_text(json.dumps(verses, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {out} ({out.stat().st_size / 1024 / 1024:.1f} MB)")

    # ── Full 384-dim embeddings, int8-quantised, for semantic search ──
    # Source vectors are already L2-normalised, so every component is in
    # [-1, 1] and a single global scale is enough. No per-row scale needed.
    quant = np.clip(np.round(embeddings * INT8_SCALE), -127, 127).astype(np.int8)
    emb_out = PUBLIC_DATA / "embeddings.i8"
    emb_out.write_bytes(quant.tobytes())
    # Report the fidelity actually achieved rather than asserting it.
    deq = quant.astype(np.float32) / INT8_SCALE
    deq /= np.linalg.norm(deq, axis=1, keepdims=True) + 1e-12
    fidelity = float((embeddings.astype(np.float32) * deq).sum(axis=1).mean())
    print(
        f"Wrote {emb_out} ({emb_out.stat().st_size / 1024 / 1024:.2f} MB, "
        f"shape {quant.shape}, mean cosine fidelity {fidelity:.4f})"
    )

    # ── PCA basis, so the client can project a query into this same space ──
    # Layout, all float32 little-endian, no header:
    #   [0 .. 384)                 pca.mean_          (384,)
    #   [384 .. 384 + 64*384)      pca.components_    (64, 384) row-major
    # The client computes: q64 = normalize(components_ @ (q384 - mean_))
    # which is exactly what fit_transform did to produce v["e"] above.
    basis = np.concatenate(
        [
            pca.mean_.astype(np.float32).ravel(),
            pca.components_.astype(np.float32).ravel(),
        ]
    )
    expected = EMBED_DIM + PCA_DIM * EMBED_DIM
    assert basis.size == expected, f"basis size {basis.size} != {expected}"
    basis_out = PUBLIC_DATA / "pca.bin"
    basis_out.write_bytes(basis.tobytes())
    print(
        f"Wrote {basis_out} ({basis_out.stat().st_size / 1024:.1f} KB, "
        f"{100 * pca.explained_variance_ratio_.sum():.1f}% variance retained)"
    )

    # Save a surah index
    surahs: dict[int, dict] = {}
    for v in verses:
        s = v["surah"]
        if s not in surahs:
            surahs[s] = {
                "number": s,
                "englishName": v["surahName"],
                "arabicName": v["surahArabic"],
                "revelationType": v["revelationType"],
                "ayahCount": 0,
            }
        surahs[s]["ayahCount"] += 1
    surah_list = sorted(surahs.values(), key=lambda x: x["number"])
    (PUBLIC_DATA / "surahs.json").write_text(
        json.dumps(surah_list, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Wrote {PUBLIC_DATA / 'surahs.json'}")


if __name__ == "__main__":
    main()

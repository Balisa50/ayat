"""
Build semantic neighbor lists + a PCA-64 projection for client-side search.
Writes the final public/data/verses.json.
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

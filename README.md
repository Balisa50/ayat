# AYAT - the Quran as a galaxy

All 6,236 verses of the Quran rendered as a 3D particle galaxy. Verses
self-organise by semantic theme using sentence-transformer embeddings → UMAP.
Meccan surahs glow cool blue, Medinan amber. Search by meaning and matching
verses light up across the cosmos; tap any particle to read it with
AI-provided historical context.

Live at [ayat-ab.vercel.app](https://ayat-ab.vercel.app).

> This is v1, kept deliberately stable. Active development happens in
> [ayat-v2](https://github.com/Balisa50/ayat-v2), which adds the
> query-conditioned galaxy layout, accounts, journeys and the rest. v1 gets
> only fixes and features that stand on their own.

## Stack
| Layer | Tool |
|---|---|
| Embeddings | `sentence-transformers` / `all-MiniLM-L6-v2` (384-dim) |
| Reduction | UMAP (384 → 3) |
| Clustering | HDBSCAN on a UMAP-reduced space |
| Client search | literal + synonym expansion, unioned with true semantic search |
| Query encoder | `transformers.js`, same MiniLM, runs in the browser |
| Visualisation | Three.js + react-three-fiber |
| Context | a hosted LLM |
| Framework | Next.js 16 |

## Semantic search

Search used to seed on literal substring matches and gate everything behind
them, so a question whose words appear nowhere in the text returned nothing.
Ask *"what should I do when I feel abandoned"* and you got an empty galaxy.

The query is now embedded in the browser with the same MiniLM the pipeline
uses (~23 MB, cached after first load) and compared against the full 384-dim
verse vectors shipped as `public/data/embeddings.i8` (int8-quantised, 2.4 MB,
lazy-loaded on first search). No inference server, no vector DB, no per-user
cost.

Two things worth knowing if you touch this:

- **It is additive.** The literal path in `lib/search.ts` is untouched and
  still paints instantly; semantic results are unioned in when they resolve.
  If the model fails to load, search behaves exactly as it did before.
- **It runs on the full 384-dim vectors, not the PCA-64 in `verses.json`.**
  PCA-64 ranks fine but destroys *absolute* similarity calibration: measured
  over 20 off-topic and 14 on-topic queries, the two sets separate with
  AUC 1.000 in 384-dim and AUC 0.480 — no signal at all — in PCA-64. Absolute
  scores are what let AYAT return *nothing* for "best pasta carbonara recipe"
  rather than a confident-looking list of near-random verses.

## A note on the clustering

`03_reduce_and_cluster.py` originally ran HDBSCAN with `metric="euclidean"` on
the raw 384-dim embeddings while UMAP correctly used cosine. Density
estimation falls apart at that dimensionality: **4,838 of 6,236 verses (78%)
came back as noise**, leaving two clusters, one of them 33 verses. "Clustered
with HDBSCAN" sat in this README for months while being effectively untrue.

It now clusters on a UMAP-reduced space, which is the standard fix, and noise
is down to 1.2%. Be aware the honest result is still only **two clusters**, of
roughly 4,000 and 2,200 — this corpus is semantically continuous rather than
clumpy, so there is no rich thematic structure for density clustering to
recover. The label is decorative; nothing in the UI depends on it.

## Running the pipeline (one-time)

```bash
cd pipeline
pip install -r requirements.txt
python 01_fetch_quran.py      # Arabic + English + transliteration from AlQuran.cloud
python 02_embed_verses.py     # ~5 min on CPU. Outputs embeddings.npy
python 03_reduce_and_cluster.py
python 04_build_graph.py      # Writes verses.json, embeddings.i8, pca.bin
```

`pca.bin` is the PCA basis. Nothing in v1 reads it — it belongs to the galaxy
reprojection, which is v2-only — but the pipeline is shared, so it ships here
rather than leaving the repo out of step with its own build output.

## Running the frontend

```bash
npm install
cp .env.example .env.local   # add the LLM API key
npm run dev
```

## Roadmap

Shipped:
- Galaxy of 6,236 verses, breathing and auto-rotating
- Meccan/Medinan colour bands
- Semantic search, running entirely in the browser
- Honest empty result when the corpus has nothing for a query
- Verse detail card with the model-provided tafsir context

Planned (phase 2):
- Theme collision view (mercy + punishment split into gravitational fields)
- Pinch-to-zoom per-Surah constellation view
- Shareable verse cards with embedded mini-constellation
- Ambient singing-bowl tones
- Multi-translation toggle

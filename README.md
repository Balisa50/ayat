# AYAT - the Quran as a galaxy

All 6,236 verses of the Quran rendered as a 3D particle galaxy. Verses self-organise by semantic theme using sentence-transformer embeddings → UMAP. Meccan surahs glow cool blue, Medinan amber. Type a theme and matching verses light up across the cosmos; tap any particle to read it with AI-provided historical context.

## Stack
| Layer | Tool |
|---|---|
| Embeddings | `sentence-transformers` / `all-MiniLM-L6-v2` (384-dim) |
| Reduction | UMAP (384 → 3) |
| Clustering | HDBSCAN |
| Client search | keyword + synonym expansion + PCA-64 semantic boost |
| Visualisation | Three.js + react-three-fiber |
| Context | a hosted LLM |
| Framework | Next.js 16 |

## Running the pipeline (one-time)

```bash
cd pipeline
pip install -r requirements.txt
python 01_fetch_quran.py      # Downloads Arabic + English + transliteration from AlQuran.cloud
python 02_embed_verses.py     # ~5 min on CPU. Outputs embeddings.npy
python 03_reduce_and_cluster.py
python 04_build_graph.py      # Writes public/data/verses.json
```

## Running the frontend

```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY
npm run dev
```

## Roadmap

Shipped:
- Galaxy of 6,236 verses, breathing and auto-rotating
- Meccan/Medinan colour bands
- Theme search with synonym expansion
- Verse detail card with the model-provided tafsir context

Planned (phase 2):
- Theme collision view (mercy + punishment split into gravitational fields)
- Pinch-to-zoom per-Surah constellation view
- Shareable verse cards with embedded mini-constellation
- Ambient singing-bowl tones
- Multi-translation toggle

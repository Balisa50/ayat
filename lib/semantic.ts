/**
 * True semantic search: embed the query in the browser, compare it directly
 * against the full 384-dim verse embeddings.
 *
 * Why this exists
 * ---------------
 * The original search (lib/search.ts) seeds on literal substring matches and
 * only then expands semantically. That seed gates everything, so a question
 * with no shared vocabulary -- "the fear of losing a child" -- returns nothing
 * at all. The verse vectors were always there; what was missing was any way to
 * put a *query* into the same space.
 *
 * Why 384-dim and not the PCA-64 already in verses.json
 * ----------------------------------------------------
 * PCA-64 ranks fine but destroys absolute similarity calibration. Measured
 * over 20 off-topic and 10 on-topic queries, top-10 mean cosine separates
 * them with AUC 1.000 in 384-dim and AUC 0.480 -- no signal -- in PCA-64.
 * Projecting into a 64-dim subspace and renormalising inflates whatever
 * component survived, so "kubernetes pod autoscaling" scores as high as
 * "patience in hardship". Absolute scores are what let us say "the Qur'an
 * doesn't address this" honestly, so search runs on the full vectors.
 *
 * Everything here is lazy and optional. If the model or the weights fail to
 * load, callers fall back to the existing literal path and the app is exactly
 * as it was.
 */

export const EMBED_DIM = 384;
export const VERSE_COUNT = 6236;
const INT8_SCALE = 127;

/**
 * A verse must be at least this close to the query to light up.
 *
 * This is the gate that does the real work, and it is calibrated rather than
 * guessed. Scoring 20 deliberately off-topic queries ("kubernetes pod
 * autoscaling config", "best pasta carbonara recipe") and 14 on-topic ones by
 * their single best match:
 *
 *   off-topic   min 0.187   median 0.259   max 0.442
 *   on-topic    min 0.412   median 0.549   max 0.735
 *
 * At 0.35 the off-topic queries return nothing at all, while "mercy" returns
 * 92 verses and "forgiving my father" 122 (both then capped by topN). That
 * empty result is the honest answer, and it is something a ranked list cannot
 * express: every search UI returns *something*, which quietly implies an
 * answer exists.
 *
 * Note the corpus answers the question it was actually asked. "interest rates
 * and mortgage refinancing" returns nothing (best match 0.277), while
 * "interest and usury" clears the bar comfortably and surfaces 2:275. The
 * model has no notion of modern mortgage products; it does know riba.
 */
export const MIN_COSINE = 0.35;

/**
 * Thresholds for the *descriptive* coherence readout. These do not gate
 * results, they only characterise the shape of what came back, and they feed
 * the arc/coherence UI later. Measured by top-10 mean cosine over the same
 * query sets: off-topic median 0.210, on-topic median 0.492.
 *
 * Both sets are small, so treat these as provisional until there are real
 * queries to re-calibrate against.
 */
export const COHERENCE = {
  /** Below this the corpus has little to say in the query's own terms. */
  FLOOR: 0.35,
  /** At or above this the top matches are tight and clearly on-theme. */
  TIGHT: 0.49,
  /** How many top matches the coherence score averages over. */
  K: 10,
} as const;

export type Coherence = "tight" | "present" | "absent";

export interface SemanticResult {
  ids: number[];
  scores: Map<number, number>;
  /** Mean cosine of the top-K matches. */
  coherence: number;
  verdict: Coherence;
}

// ─────────────────────────── verse matrix ───────────────────────────

let matrix: Float32Array | null = null;
let matrixPromise: Promise<Float32Array | null> | null = null;

/**
 * Load and dequantise the int8 verse embeddings (2.4 MB over the wire).
 * Rows come back L2-normalised so a dot product is cosine.
 *
 * Exported as `loadVerseMatrix` so the reprojection path shares this one
 * cached copy rather than decoding a second 9.6 MB Float32Array of its own.
 */
async function loadMatrix(): Promise<Float32Array | null> {
  if (matrix) return matrix;
  if (matrixPromise) return matrixPromise;

  matrixPromise = (async () => {
    try {
      const res = await fetch("/data/embeddings.i8", { cache: "force-cache" });
      if (!res.ok) throw new Error(`embeddings.i8 ${res.status}`);
      const buf = await res.arrayBuffer();

      const expected = VERSE_COUNT * EMBED_DIM;
      if (buf.byteLength !== expected) {
        throw new Error(`embeddings.i8 is ${buf.byteLength} bytes, expected ${expected}`);
      }

      const raw = new Int8Array(buf);
      const out = new Float32Array(expected);
      for (let i = 0; i < VERSE_COUNT; i++) {
        const base = i * EMBED_DIM;
        let norm = 0;
        for (let j = 0; j < EMBED_DIM; j++) {
          const val = raw[base + j] / INT8_SCALE;
          out[base + j] = val;
          norm += val * val;
        }
        norm = Math.sqrt(norm) || 1;
        for (let j = 0; j < EMBED_DIM; j++) out[base + j] /= norm;
      }

      matrix = out;
      return out;
    } catch (err) {
      console.warn("[semantic] verse embeddings unavailable:", err);
      matrixPromise = null; // let a later attempt retry
      return null;
    }
  })();

  return matrixPromise;
}

// ─────────────────────────── query encoder ───────────────────────────

type Extractor = (text: string, opts: { pooling: "mean"; normalize: boolean }) => Promise<{
  data: Float32Array | number[];
}>;

let extractor: Extractor | null = null;
let extractorPromise: Promise<Extractor | null> | null = null;

/**
 * Lazily pull in transformers.js and the MiniLM weights (~23 MB, cached by the
 * browser after first load). Same model the pipeline used, so the query lands
 * in the same space as the verses.
 */
async function loadExtractor(): Promise<Extractor | null> {
  if (extractor) return extractor;
  if (extractorPromise) return extractorPromise;

  extractorPromise = (async () => {
    try {
      const { pipeline } = await import("@huggingface/transformers");
      const pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
      extractor = pipe as unknown as Extractor;
      return extractor;
    } catch (err) {
      console.warn("[semantic] query encoder unavailable:", err);
      extractorPromise = null;
      return null;
    }
  })();

  return extractorPromise;
}

export { loadMatrix as loadVerseMatrix };

/** Kick off both downloads without blocking. Safe to call repeatedly. */
export function warmUp(): void {
  void loadMatrix();
  void loadExtractor();
}

/** True once a semantic search can run without waiting on a download. */
export function isReady(): boolean {
  return matrix !== null && extractor !== null;
}

/** Embed a query to a unit-norm 384-dim vector, or null if unavailable. */
export async function embedQuery(text: string): Promise<Float32Array | null> {
  const pipe = await loadExtractor();
  if (!pipe) return null;

  const out = await pipe(text, { pooling: "mean", normalize: true });
  const vec = Float32Array.from(out.data as ArrayLike<number>);
  if (vec.length !== EMBED_DIM) {
    console.warn(`[semantic] expected ${EMBED_DIM} dims, got ${vec.length}`);
    return null;
  }
  return vec;
}

// ─────────────────────────── search ───────────────────────────

function verdictFor(coherence: number): Coherence {
  if (coherence >= COHERENCE.TIGHT) return "tight";
  if (coherence >= COHERENCE.FLOOR) return "present";
  return "absent";
}

/**
 * Rank every verse against the query.
 *
 * `verseIds[i]` must be the id of the verse whose embedding is row i, i.e. the
 * verses.json order the pipeline wrote. Returns null when the model or weights
 * aren't loaded, which is the caller's signal to keep the literal results.
 */
export async function semanticSearch(
  query: string,
  verseIds: number[],
  topN = 60
): Promise<SemanticResult | null> {
  const text = query.trim();
  if (!text) return null;

  const [mat, vec] = await Promise.all([loadMatrix(), embedQuery(text)]);
  if (!mat || !vec) return null;

  const n = Math.min(verseIds.length, VERSE_COUNT);
  const sims = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const base = i * EMBED_DIM;
    let acc = 0;
    for (let j = 0; j < EMBED_DIM; j++) acc += mat[base + j] * vec[j];
    sims[i] = acc;
  }

  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => sims[b] - sims[a]);

  const k = Math.min(COHERENCE.K, order.length);
  let coherence = 0;
  for (let i = 0; i < k; i++) coherence += sims[order[i]];
  coherence = k > 0 ? coherence / k : 0;

  // Absolute closeness, not "the top N of whatever ranking came back". A query
  // the corpus has nothing to say about returns an empty set, which is the
  // point: see MIN_COSINE.
  const ids: number[] = [];
  const scores = new Map<number, number>();
  for (let i = 0; i < order.length && ids.length < topN; i++) {
    const idx = order[i];
    if (sims[idx] < MIN_COSINE) break;
    ids.push(verseIds[idx]);
    scores.set(verseIds[idx], sims[idx]);
  }

  return { ids, scores, coherence, verdict: verdictFor(coherence) };
}

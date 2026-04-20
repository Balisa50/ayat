import type { Verse } from "./types";

/**
 * Thematic synonym expansion. Seeds the centroid for semantic ranking.
 */
const SYNONYMS: Record<string, string[]> = {
  patience: ["patience", "patient", "endure", "persevere", "steadfast", "forbear", "bear with"],
  mercy: ["mercy", "merciful", "compassion", "compassionate", "most merciful", "kind"],
  prayer: ["prayer", "pray", "prostrate", "worship", "salah", "supplication", "supplicate", "invocation"],
  paradise: ["paradise", "gardens beneath", "bliss", "jannah", "garden of eden", "eternal bliss"],
  hell: ["hell", "hellfire", "blazing fire", "torment", "punishment of the fire", "chastisement", "abode of fire"],
  faith: ["faith", "believe", "belief", "iman", "trust in allah", "trust in god"],
  charity: ["charity", "alms", "zakat", "spend in the way", "needy", "poor", "give in the way", "spend of your wealth"],
  knowledge: ["knowledge", "learn", "understand", "wisdom", "wise", "knowing", "all-knowing"],
  forgiveness: ["forgives", "forgiving", "forgiven", "pardon", "oft-forgiving", "most forgiving", "repent", "repentance", "accepts repentance", "turn to him in repentance"],
  family: ["parents", "mother", "father", "children", "kin", "relatives", "spouse"],
  prophet: ["prophet", "messenger", "apostle"],
  believer: ["believer", "believers", "faithful"],
  disbeliever: ["disbeliever", "disbelievers", "unbelievers", "deny", "reject"],
  creation: ["create", "created", "creation", "creator"],
  death: ["death", "die", "died", "dying", "dead"],
  judgment: ["day of judgment", "resurrection", "reckoning", "account"],
  light: ["light", "luminous", "shining", "bright", "radiance"],
  guidance: ["guidance", "guide", "guided", "path", "straight path"],
  justice: ["justice", "just", "fair", "equity"],
  gratitude: ["grateful", "gratitude", "thank", "thankful"],
  wealth: ["wealth", "riches", "treasure", "property"],
  orphan: ["orphan", "orphans"],
  food: ["food", "eat", "sustenance", "provision"],
  nature: ["sun", "moon", "stars", "sky", "earth", "mountain", "sea", "rain", "wind"],
};

/**
 * Stop words stripped when tokenising multi-word queries.
 * Keeps meaningful content words (nouns, verbs, adjectives).
 */
const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by",
  "from","was","is","are","were","been","be","have","has","had","do","does",
  "did","will","would","could","should","may","might","shall","can","it","its",
  "they","he","she","we","i","you","them","him","her","us","my","your","his",
  "our","their","this","that","these","those","there","then","than","as","so",
  "if","not","no","about","even","also","just","only","who","what","when",
  "where","how","why","which","very","more","some","such","all","any","into",
  "out","up","down","after","before","over","under","through","upon","among",
  "yet","too","very","own","same","other","each","both","here","now",
  // Query meta-words that appear in user questions but not in Quran text
  "verse","verses","ayah","ayat","surah","sura","chapter","chapters",
  "starting","start","starts","begin","begins","beginning","beginnings",
  "contain","contains","mention","mentions","related","show","shows",
  "about","find","give","tell","list","words","word","text","passage",
  "quran","says","said","ends","ending",
]);

/**
 * Extract meaningful content words from a query.
 * Strips punctuation, lower-cases, removes stop words and short tokens.
 */
function extractTokens(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function seedTerms(q: string): string[] {
  const key = q.trim().toLowerCase();
  if (!key) return [];
  // Direct synonym lookup
  if (SYNONYMS[key]) return SYNONYMS[key];
  for (const [k, syns] of Object.entries(SYNONYMS)) {
    if (k.startsWith(key) || key.startsWith(k)) return syns;
  }
  // Multi-word query: return individual content tokens so literalMatches
  // can do AND-style matching rather than looking for the whole phrase.
  const tokens = extractTokens(q);
  if (tokens.length > 0) return tokens;
  return [key];
}

/**
 * Literal-match seed set.
 *
 * For single-token queries (or synonym expansions) → OR match: any term.
 * For multi-token queries → AND match: require most tokens to co-occur
 * in the same verse so the seed stays tight and the centroid is accurate.
 */
function literalMatches(verses: Verse[], terms: string[], queryTokens: string[]): Set<number> {
  const out = new Set<number>();
  const multiToken = queryTokens.length >= 2;

  // How many tokens must appear in the same verse.
  // 2 tokens → both must match. 3+ → 65% must match (at least 2).
  const needed = multiToken
    ? queryTokens.length === 2 ? 2 : Math.max(2, Math.ceil(queryTokens.length * 0.65))
    : 1;

  for (const v of verses) {
    const text = v.translation.toLowerCase();

    if (!multiToken) {
      // Original behaviour: OR match across any seed term
      for (const t of terms) {
        if (text.includes(t)) { out.add(v.id); break; }
      }
    } else {
      // Multi-word query: require `needed` tokens to appear together
      const hits = queryTokens.filter((t) => text.includes(t)).length;
      if (hits >= needed) out.add(v.id);
    }
  }
  return out;
}

/**
 * Semantic match:
 * 1) Seed with literal string matches on synonym-expanded terms
 *    (or co-occurring tokens for multi-word queries)
 * 2) Compute centroid of the seeds in PCA-64 embedding space
 * 3) Re-rank ALL verses by cosine similarity to the centroid
 * 4) Return the top-N most coherent verses
 */
export function matchVerses(verses: Verse[], query: string, topN?: number): Set<number> {
  const terms = seedTerms(query);
  if (terms.length === 0) return new Set();

  // Tokens from the raw query (used for AND-matching in literalMatches)
  const queryTokens = extractTokens(query);

  const seed = literalMatches(verses, terms, queryTokens);
  if (seed.size === 0) return new Set();

  const effectiveTopN = topN ?? Math.max(20, Math.min(60, Math.ceil(seed.size * 1.2)));

  // Fall back to literal if embeddings missing
  if (!verses[0]?.e || verses[0].e.length === 0) return seed;

  // Centroid of seeds
  const dim = verses[0].e.length;
  const centroid = new Array(dim).fill(0);
  let count = 0;
  for (const v of verses) {
    if (!seed.has(v.id)) continue;
    for (let i = 0; i < dim; i++) centroid[i] += v.e[i];
    count++;
  }
  if (count === 0) return seed;
  for (let i = 0; i < dim; i++) centroid[i] /= count;
  // Normalize
  let norm = 0;
  for (const x of centroid) norm += x * x;
  norm = Math.sqrt(norm) + 1e-12;
  for (let i = 0; i < dim; i++) centroid[i] /= norm;

  const MIN_COSINE = 0.50;
  const LITERAL_BONUS = 0.6;
  type Scored = { id: number; cos: number; score: number; literal: boolean };
  const scored: Scored[] = [];
  for (const v of verses) {
    let s = 0;
    for (let i = 0; i < dim; i++) s += centroid[i] * v.e[i];
    const literal = seed.has(v.id);
    const score = literal ? s + LITERAL_BONUS : s;
    scored.push({ id: v.id, cos: s, score, literal });
  }
  scored.sort((a, b) => b.score - a.score);

  const out = new Set<number>();
  const limit = Math.min(effectiveTopN, scored.length);
  for (let i = 0; i < limit; i++) {
    const row = scored[i];
    if (!row.literal && row.cos < MIN_COSINE) continue;
    out.add(row.id);
  }
  return out;
}

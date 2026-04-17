import type { Verse } from "./types";

/**
 * Thematic synonym expansion. Keyword search in English translation
 * across all related terms. Tuned for common Quranic themes.
 */
const SYNONYMS: Record<string, string[]> = {
  patience: ["patience", "patient", "endure", "persevere", "steadfast", "forbear", "bear"],
  mercy: ["mercy", "merciful", "compassion", "forgiving", "forgiveness", "kind", "kindness"],
  prayer: ["prayer", "pray", "prostrate", "bow", "worship", "salah"],
  paradise: ["paradise", "garden", "heaven", "bliss", "jannah"],
  hell: ["hell", "fire", "hellfire", "blazing", "torment", "punishment"],
  faith: ["faith", "believe", "belief", "trust", "iman"],
  charity: ["charity", "alms", "give", "zakat", "spending", "needy", "poor"],
  knowledge: ["knowledge", "know", "learn", "understand", "wisdom", "wise"],
  forgiveness: ["forgive", "forgiving", "forgiven", "pardon", "absolve", "mercy"],
  family: ["parents", "mother", "father", "children", "kin", "relatives", "family", "spouse"],
  prophet: ["prophet", "messenger", "apostle", "envoy", "sent"],
  believer: ["believer", "believers", "faithful"],
  disbeliever: ["disbeliever", "disbelievers", "unbelievers", "deny", "reject"],
  creation: ["create", "created", "creation", "creator", "formed", "shaped"],
  death: ["death", "die", "died", "dying", "dead", "grave"],
  judgment: ["judgment", "judge", "day of judgment", "resurrection", "reckoning", "account"],
  light: ["light", "luminous", "shining", "bright", "radiance"],
  guidance: ["guidance", "guide", "guided", "path", "straight"],
  justice: ["justice", "just", "fair", "balance", "equity"],
  gratitude: ["grateful", "gratitude", "thank", "thankful", "thanks"],
  wealth: ["wealth", "riches", "treasure", "property", "possessions"],
  orphan: ["orphan", "orphans"],
  food: ["food", "eat", "drink", "sustenance", "provision"],
  nature: ["sun", "moon", "stars", "sky", "earth", "mountain", "sea", "rain", "wind"],
};

export function expandQuery(q: string): string[] {
  const key = q.trim().toLowerCase();
  if (!key) return [];
  if (SYNONYMS[key]) return SYNONYMS[key];
  // Partial match: "merci" -> mercy
  for (const [k, syns] of Object.entries(SYNONYMS)) {
    if (k.startsWith(key) || key.startsWith(k)) return syns;
  }
  return [key];
}

export function matchVerses(verses: Verse[], query: string): Set<number> {
  const terms = expandQuery(query);
  if (terms.length === 0) return new Set();
  const out = new Set<number>();
  for (const v of verses) {
    const text = v.translation.toLowerCase();
    for (const t of terms) {
      if (text.includes(t)) {
        out.add(v.id);
        break;
      }
    }
  }
  return out;
}

/**
 * Optional: semantic boost using the PCA embeddings. Computes query centroid
 * as the mean of matched verses' embeddings, then pulls in top-K closest
 * unmatched verses.
 */
export function semanticExpand(
  verses: Verse[],
  matched: Set<number>,
  topK = 20
): Set<number> {
  if (matched.size === 0) return matched;
  const matchedVerses = verses.filter((v) => matched.has(v.id));
  const dim = matchedVerses[0].e.length;
  const centroid = new Array(dim).fill(0);
  for (const v of matchedVerses) {
    for (let i = 0; i < dim; i++) centroid[i] += v.e[i];
  }
  for (let i = 0; i < dim; i++) centroid[i] /= matchedVerses.length;
  // Normalize centroid
  let norm = 0;
  for (const x of centroid) norm += x * x;
  norm = Math.sqrt(norm) + 1e-12;
  for (let i = 0; i < dim; i++) centroid[i] /= norm;

  const scored: Array<[number, number]> = [];
  for (const v of verses) {
    if (matched.has(v.id)) continue;
    let s = 0;
    for (let i = 0; i < dim; i++) s += centroid[i] * v.e[i];
    scored.push([v.id, s]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  const out = new Set(matched);
  for (let i = 0; i < Math.min(topK, scored.length); i++) {
    if (scored[i][1] > 0.5) out.add(scored[i][0]);
  }
  return out;
}

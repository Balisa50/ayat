import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkRateLimit, getCallerId } from "@/lib/rate-limit";
import { chat, AiUnavailableError, availableProviders, AI_UNAVAILABLE_MESSAGE } from "@/lib/ai-pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Verse Detective, grounded in the local dataset.
 *
 * Before asking the model, a text-match pass over all 6,236 verses returns
 * the top candidates. The model's job is to choose between them — not to
 * invent a reference from memory, because the last version let it and the
 * result was plausible-looking surah:ayah pairs that had nothing to do with
 * the query. The instruction is now explicit: pick from the list, or return
 * an empty array. Honesty beats confidence.
 *
 * Two additional candidate sources were added after the first user tests:
 *   1. Explicit references. "2:255", "verse 255 of surah 2", "the throne
 *      verse" as a named anchor → return that verse first, always.
 *   2. Surah names. "Yusuf", "the cave", "Maryam" → return the opening
 *      verses of the named surah, because most users who name a surah want
 *      its famous passage, and the model should not have to guess.
 *
 * Every returned match is validated twice: once against the dataset bounds
 * (does the surah/ayah exist), and once against the verse's own translation
 * (does the text actually contain the query's key terms).
 */

const SYSTEM = `You are a Quran verse detective. The user will describe a verse, a story, a historical context, a feeling, or anything they remember, sometimes vague, sometimes a fragment of Arabic or transliteration, sometimes a theme. Your job: choose the best match from the candidate verses you are given.

CRITICAL RULE: You must choose ONLY from the candidate verses provided below. Do not invent a reference from your own knowledge. Do not return a surah:ayah pair that is not in the candidate list. If none of the candidates fit the user's description, return an empty array []. Returning nothing is a correct answer.

You will be given up to 20 candidate verses found by text search plus a handful of surah-opening verses if a surah was named. These are your only options.

Return ALL plausible matches above 0.35 confidence, ordered by confidence descending. Shape:
[
 {"surah_number": <1-114>, "verse_number": <int>, "confidence": <0.0-1.0>, "reason": "<one sentence, plain text>"}
]

Confidence scale:
- 0.85-1.00 = this is unmistakably the verse described (unique phrase, famous story, exact wording)
- 0.60-0.84 = strong match on multiple dimensions
- 0.35-0.59 = plausible partial match
- below 0.35 = do not return

Rules:
- NEVER return a surah:ayah pair that is not in the candidate list.
- Every "reason" must name a specific word or phrase from the verse that matches the query. If you cannot point to a specific overlap, do not return the verse.
- If the candidates include the exact answer, return it with confidence above 0.9. If they only include near-misses, return those at their real confidence, not inflated.
- Return the array and nothing else. No prose. No markdown. No backticks.
- One sentence per "reason". Plain text.`;

type RawVerse = {
  id: number;
  surah: number;
  ayah: number;
  surahName: string;
  translation: string;
};

type DetectiveMatch = {
  surah_number: number;
  verse_number: number;
  confidence: number;
  reason: string;
};

type ValidatedMatch = {
  surah: number;
  ayah: number;
  confidence: number;
  reason: string;
};

let versesCache: RawVerse[] | null = null;

async function loadVerses(): Promise<RawVerse[]> {
  if (versesCache) return versesCache;
  const p = path.join(process.cwd(), "public", "data", "verses.json");
  const raw = await readFile(p, "utf-8");
  versesCache = JSON.parse(raw) as RawVerse[];
  return versesCache;
}

// Common English stop words. Removed from the query before matching.
const STOP = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by",
  "from","was","is","are","were","been","be","have","has","had","do","does",
  "did","will","would","could","should","may","might","shall","can","it","its",
  "they","he","she","we","i","you","them","him","her","us","my","your","his",
  "our","their","this","that","these","those","there","then","than","as","so",
  "if","not","no","about","even","also","just","only","who","what","when",
  "where","how","why","which","very","more","some","such","all","any","into",
  "out","up","down","after","before","over","under","through","upon","among",
  "verse","verses","surah","sura","chapter","ayah","ayat","saying","says",
  "says","said","tell","me","something","anything","thing","things",
]);

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^\w\s:]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** Surah-name → number map, matching English names and common alternatives. */
const SURAH_NAMES: Record<string, number> = {
  "fatiha": 1, "fatihah": 1, "opening": 1,
  "baqarah": 2, "baqara": 2, "cow": 2,
  "imran": 3, "family of imran": 3,
  "nisa": 4, "women": 4,
  "maidah": 5, "maida": 5, "table": 5,
  "anam": 6, "cattle": 6,
  "araf": 7,
  "anfal": 8,
  "tawbah": 9, "tawba": 9, "repentance": 9,
  "yunus": 10, "jonah": 10,
  "hud": 11,
  "yusuf": 12, "joseph": 12,
  "rad": 13, "thunder": 13,
  "ibrahim": 14, "abraham": 14,
  "hijr": 15,
  "nahl": 16, "bee": 16, "bees": 16,
  "isra": 17, "night journey": 17,
  "kahf": 18, "cave": 18,
  "maryam": 19, "mary": 19,
  "taha": 20,
  "anbiya": 21, "prophets": 21,
  "hajj": 22, "pilgrimage": 22,
  "muminun": 23, "believers": 23,
  "nur": 24, "light": 24,
  "furqan": 25,
  "shuara": 26, "poets": 26,
  "naml": 27, "ant": 27, "ants": 27,
  "qasas": 28, "stories": 28,
  "ankabut": 29, "spider": 29,
  "rum": 30, "romans": 30,
  "luqman": 31,
  "sajdah": 32, "prostration": 32,
  "ahzab": 33, "confederates": 33,
  "saba": 34, "sheba": 34,
  "fatir": 35, "originator": 35,
  "yasin": 36, "ya sin": 36,
  "saffat": 37,
  "sad": 38,
  "zumar": 39, "troops": 39,
  "ghafir": 40, "forgiver": 40,
  "fussilat": 41,
  "shura": 42, "consultation": 42,
  "zukhruf": 43, "gold": 43,
  "dukhan": 44, "smoke": 44,
  "jathiyah": 45, "kneeling": 45,
  "ahqaf": 46,
  "muhammad": 47,
  "fath": 48, "victory": 48,
  "hujurat": 49, "rooms": 49,
  "qaf": 50,
  "dhariyat": 51,
  "tur": 52, "mount": 52,
  "najm": 53, "star": 53,
  "qamar": 54, "moon": 54,
  "rahman": 55, "most gracious": 55,
  "waqiah": 56,
  "hadid": 57, "iron": 57,
  "mujadilah": 58,
  "hashr": 59,
  "mumtahanah": 60,
  "saff": 61, "ranks": 61,
  "jumuah": 62, "friday": 62,
  "munafiqun": 63, "hypocrites": 63,
  "taghabun": 64,
  "talaq": 65, "divorce": 65,
  "tahrim": 66, "prohibition": 66,
  "mulk": 67, "sovereignty": 67,
  "qalam": 68, "pen": 68,
  "haqqah": 69,
  "maarij": 70,
  "nuh": 71, "noah": 71,
  "jinn": 72,
  "muzzammil": 73,
  "muddaththir": 74,
  "qiyamah": 75, "resurrection": 75,
  "insan": 76, "man": 76,
  "mursalat": 77,
  "naba": 78, "news": 78,
  "naziat": 79,
  "abasa": 80,
  "takwir": 81,
  "infitar": 82,
  "mutaffifin": 83,
  "inshiqaq": 84,
  "buruj": 85, "constellations": 85,
  "tariq": 86,
  "ala": 87, "most high": 87,
  "ghashiyah": 88,
  "fajr": 89, "dawn": 89,
  "balad": 90, "city": 90,
  "shams": 91, "sun": 91,
  "layl": 92, "night": 92,
  "duha": 93,
  "sharh": 94, "inshirah": 94,
  "tin": 95, "fig": 95,
  "alaq": 96, "clot": 96,
  "qadr": 97, "decree": 97,
  "bayyinah": 98, "clear proof": 98,
  "zalzalah": 99, "earthquake": 99,
  "adiyat": 100,
  "qariah": 101,
  "takathur": 102,
  "asr": 103, "time": 103,
  "humazah": 104,
  "fil": 105, "elephant": 105,
  "quraysh": 106,
  "maun": 107,
  "kawthar": 108,
  "kafirun": 109, "disbelievers": 109,
  "nasr": 110, "help": 110,
  "masad": 111, "lahab": 111,
  "ikhlas": 112, "sincerity": 112,
  "falaq": 113, "daybreak": 113,
  "nas": 114, "mankind": 114,
};

/** Extracts explicit "2:255", "surah 2:255", "verse 255 of surah 2" references. */
function parseExplicitRef(query: string): { surah: number; ayah: number } | null {
  const q = query.trim();
  // "2:255", "2.255", "2 255"
  const m1 = q.match(/\b(\d{1,3})\s*[:.\-]\s*(\d{1,3})\b/);
  if (m1) {
    const s = parseInt(m1[1], 10);
    const a = parseInt(m1[2], 10);
    if (s >= 1 && s <= 114 && a >= 1 && a <= 286) return { surah: s, ayah: a };
  }
  // "verse 255 of surah 2", "ayah 255 in sura 2"
  const m2 = q.match(/\b(?:verse|ayah|ayat|v|a)\s+(\d{1,3})\s+(?:of|in|from)\s+(?:surah|sura|chapter)\s+(\d{1,3})\b/i);
  if (m2) {
    const a = parseInt(m2[1], 10);
    const s = parseInt(m2[2], 10);
    if (s >= 1 && s <= 114 && a >= 1 && a <= 286) return { surah: s, ayah: a };
  }
  // "surah 2 verse 255", "sura 2 ayah 255"
  const m3 = q.match(/\b(?:surah|sura|chapter)\s+(\d{1,3})\s+(?:verse|ayah|ayat|v|a)\s+(\d{1,3})\b/i);
  if (m3) {
    const s = parseInt(m3[1], 10);
    const a = parseInt(m3[2], 10);
    if (s >= 1 && s <= 114 && a >= 1 && a <= 286) return { surah: s, ayah: a };
  }
  return null;
}

/** Detects a named surah ("Yusuf", "the cave", "Maryam") in the query. */
function parseSurahName(query: string): number | null {
  const q = query.toLowerCase().replace(/[^\w\s]/g, " ");
  // Try two-word matches first ("family of imran", "ya sin"), then single.
  const words = q.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length - 1; i++) {
    const two = `${words[i]} ${words[i + 1]}`;
    if (SURAH_NAMES[two]) return SURAH_NAMES[two];
  }
  for (const w of words) {
    if (SURAH_NAMES[w]) return SURAH_NAMES[w];
  }
  return null;
}

/**
 * Fast text match over all verses. Returns top-N by token overlap score.
 *
 * Two extra candidate sources run before the token pass:
 *   - Explicit reference ("2:255") → that verse goes in first.
 *   - Named surah ("Yusuf") → the first six verses of that surah go in next,
 *     because a named surah almost always means the asker wants its famous
 *     passage, not a random verse with a coincidental word overlap.
 */
function findCandidates(verses: RawVerse[], query: string, topN = 20): RawVerse[] {
  const seen = new Set<number>();
  const out: RawVerse[] = [];

  const push = (v: RawVerse) => {
    if (seen.has(v.id)) return;
    seen.add(v.id);
    out.push(v);
  };

  const explicit = parseExplicitRef(query);
  if (explicit) {
    const v = verses.find((x) => x.surah === explicit.surah && x.ayah === explicit.ayah);
    if (v) push(v);
  }

  const surah = parseSurahName(query);
  if (surah) {
    const inSurah = verses
      .filter((v) => v.surah === surah)
      .sort((a, b) => a.ayah - b.ayah)
      .slice(0, 6);
    for (const v of inSurah) push(v);
  }

  const tokens = tokenize(query);
  if (tokens.length > 0) {
    const queryLower = query.toLowerCase();
    const scored: { verse: RawVerse; score: number }[] = [];

    for (const v of verses) {
      if (seen.has(v.id)) continue;
      const text = v.translation.toLowerCase();
      const surahLower = v.surahName.toLowerCase();

      let score = 0;
      for (const t of tokens) {
        if (text.includes(t)) score += 1;
        if (surahLower.includes(t)) score += 0.5;
      }
      if (tokens.length >= 2 && text.includes(queryLower)) score += 2;
      if (score > 0) scored.push({ verse: v, score });
    }

    scored.sort((a, b) => b.score - a.score);
    for (const s of scored.slice(0, topN - out.length)) push(s.verse);
  }

  return out;
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*/g, "")
    .trim();
}

function extractJsonArray(raw: string): unknown {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

type ExcludeRef = { surah: number; ayah: number };

async function askModel(
  query: string,
  candidates: RawVerse[],
  retryHint: string | null,
  exclude: ExcludeRef[] = [],
): Promise<DetectiveMatch[] | null> {
  const candidateBlock =
    candidates.length > 0
      ? `\n\nCandidate verses (choose ONLY from this list):\n${candidates
          .map(
            (v, i) =>
              `${i + 1}. ${v.surahName} ${v.surah}:${v.ayah}, "${v.translation.slice(0, 160)}${v.translation.length > 160 ? "..." : ""}"`,
          )
          .join("\n")}\n\nReturn the best matches from this list, or [] if none fit. Do not invent any reference not shown above.`
      : "\n\nNo candidate verses matched the query text. Return [] — do not invent a reference.";

  const excludeBlock =
    exclude.length > 0
      ? `\n\nDo NOT return any of these already-shown verses: ${exclude.map((e) => `${e.surah}:${e.ayah}`).join(", ")}.`
      : "";

  const userContent = retryHint
    ? `${query}${candidateBlock}${excludeBlock}\n\n(Previous attempt returned references outside the candidate list. Return ONLY candidates from the numbered list above, or [].)`
    : `${query}${candidateBlock}${excludeBlock}`;

  let raw = "";
  try {
    const result = await chat({
      system: SYSTEM,
      messages: [{ role: "user", content: userContent }],
      maxTokens: 2048,
      temperature: 0.3,
      timeoutMs: 15_000,
      deadlineMs: 25_000,
      attemptsPerModel: 1,
    });
    raw = result.text;
    if (result.fellBackFrom.length > 0) {
      console.warn(`[reflect] answered by ${result.provider}/${result.model} after ${result.fellBackFrom.join(", ")} failed`);
    }
  } catch (err) {
    if (err instanceof AiUnavailableError) throw err;
    return null;
  }
  const parsed = extractJsonArray(raw);
  if (!Array.isArray(parsed)) return null;

  const out: DetectiveMatch[] = [];
  for (const item of parsed) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as DetectiveMatch).surah_number === "number" &&
      typeof (item as DetectiveMatch).verse_number === "number" &&
      typeof (item as DetectiveMatch).confidence === "number" &&
      typeof (item as DetectiveMatch).reason === "string"
    ) {
      out.push(item as DetectiveMatch);
    }
  }
  return out;
}

/**
 * Two-layer validation.
 *
 * Layer 1: dataset bounds. Is the surah/ayah actually in the Quran?
 * Layer 2: translation match. Does the verse text contain at least one of
 * the query's key terms? A model that says "this verse about mercy" and
 * points at verse 2:35 (which is not about mercy) fails layer 2, and the
 * match is dropped. This is what stops the wrong-verse output that survived
 * the range check in the previous version.
 */
async function validate(
  matches: DetectiveMatch[],
  verses: RawVerse[],
  query: string,
): Promise<ValidatedMatch[]> {
  const boundsMap = new Map<number, number>();
  for (const v of verses) {
    const cur = boundsMap.get(v.surah) ?? 0;
    if (v.ayah > cur) boundsMap.set(v.surah, v.ayah);
  }

  const queryTokens = new Set(tokenize(query));

  const good: ValidatedMatch[] = [];
  for (const m of matches) {
    const surah = m.surah_number;
    const ayah = m.verse_number;
    if (
      !Number.isInteger(surah) || surah < 1 || surah > 114 ||
      !Number.isInteger(ayah) || ayah < 1
    ) continue;
    const max = boundsMap.get(surah);
    if (!max || ayah > max) continue;
    if (m.confidence < 0.35) continue;

    // Layer 2: the verse's own translation must overlap the query terms,
    // unless the query was tiny (1-2 terms) or was an explicit reference.
    const verse = verses.find((v) => v.surah === surah && v.ayah === ayah);
    if (verse && queryTokens.size >= 2) {
      const text = verse.translation.toLowerCase();
      const surahNameLower = verse.surahName.toLowerCase();
      let overlap = 0;
      for (const t of queryTokens) {
        if (text.includes(t) || surahNameLower.includes(t)) overlap++;
      }
      // Require at least one overlap OR a named-surah match.
      const namedSurah = parseSurahName(query);
      const matchesNamedSurah = namedSurah !== null && surah === namedSurah;
      const explicit = parseExplicitRef(query);
      const matchesExplicit = explicit !== null && surah === explicit.surah && ayah === explicit.ayah;
      if (overlap === 0 && !matchesNamedSurah && !matchesExplicit) continue;
    }

    good.push({
      surah,
      ayah,
      confidence: Math.max(0, Math.min(1, m.confidence)),
      reason: stripMarkdown(m.reason).slice(0, 300),
    });
  }
  good.sort((a, b) => b.confidence - a.confidence);
  return good.slice(0, 10);
}

/**
 * Turn text-search candidates into the same shape the model produces.
 *
 * Used only after the model has been tried and retried, and both failed.
 * The verse reference and translation are real; the confidence is set low
 * so the client renders them as a fallback tier, not a strong answer.
 */
function textSearchFallback(candidates: RawVerse[]): ValidatedMatch[] {
  return candidates.slice(0, 8).map((v, i) => ({
    surah: v.surah,
    ayah: v.ayah,
    confidence: Math.max(0.35, 0.6 - i * 0.05),
    reason: "Matched on the words in your search.",
  }));
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(getCallerId(req.headers), 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  let query = "";
  try {
    const body = await req.json();
    query =
      typeof body?.feeling === "string"
        ? body.feeling
        : typeof body?.query === "string"
          ? body.query
          : "";

    if (!query.trim()) {
      return NextResponse.json({ error: "Tell me what you're looking for." }, { status: 400 });
    }
    if (query.length > 500) {
      return NextResponse.json({ error: "Keep it under 500 characters." }, { status: 400 });
    }

    const excludeRaw: unknown[] = Array.isArray(body?.exclude) ? body.exclude : [];
    const exclude: ExcludeRef[] = excludeRaw
      .filter(
        (e): e is ExcludeRef =>
          !!e &&
          typeof e === "object" &&
          typeof (e as ExcludeRef).surah === "number" &&
          typeof (e as ExcludeRef).ayah === "number",
      )
      .slice(0, 80);

    const verses = await loadVerses();
    const candidates = findCandidates(verses, query.trim(), 20);

    if (availableProviders().length === 0) {
      return NextResponse.json({
        matches: textSearchFallback(candidates),
        degraded: true,
      });
    }

    let matches = await askModel(query.trim(), candidates, null, exclude);
    let validated = matches ? await validate(matches, verses, query.trim()) : [];

    if (validated.length === 0) {
      const invalid = (matches ?? [])
        .map((m) => `${m.surah_number}:${m.verse_number}`)
        .join(", ");
      const hint = invalid
        ? `Avoid these invalid refs: ${invalid}.`
        : "Double-check your numbering against the candidate list.";
      matches = await askModel(query.trim(), candidates, hint, exclude);
      validated = matches ? await validate(matches, verses, query.trim()) : [];
    }

    if (validated.length === 0 && candidates.length > 0) {
      return NextResponse.json({
        matches: textSearchFallback(candidates),
        degraded: true,
      });
    }

    if (validated.length === 0) {
      return NextResponse.json(
        {
          matches: [],
          message: "Nothing strong came up. Try a different angle, a specific phrase, a story, a name.",
        },
        { status: 200 },
      );
    }

    return NextResponse.json({ matches: validated });
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      try {
        const verses = await loadVerses();
        const fallback = textSearchFallback(findCandidates(verses, query.trim(), 8));
        if (fallback.length > 0) {
          return NextResponse.json({ matches: fallback, degraded: true });
        }
      } catch {
        // fall through
      }
      return NextResponse.json(
        { matches: [], unavailable: true, error: err.message },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Verse Detective — grounded in local dataset.
 *
 * Before asking Claude, we run a lightweight text-match pass over all 6236
 * verses to find the top 5 candidates. Those candidates (with surah name,
 * number, and translation snippet) are injected into the Claude prompt.
 * This grounds the model's response in real verse data rather than relying on
 * its memory alone. Claude then picks the best match from the candidates, or
 * returns a different verse if it is certain. Every returned reference is
 * validated against the local dataset before we send it back.
 */

const SYSTEM = `You are a Quran verse detective. The user will describe a verse, a story, a historical context, a feeling, or anything they remember — sometimes vague, sometimes a fragment of Arabic or transliteration, sometimes a theme. Your job: identify the most likely verse or verses being referenced.

Search across: literal meaning, tafsir tradition (Ibn Kathir, Al-Tabari, As-Sa'di, Ar-Razi), asbab al-nuzul (occasions of revelation), themes, and the stories of prophets.

You will be given up to 5 candidate verses found by text search. These are your primary candidates. Evaluate them carefully against the user's description. If one or more are strong matches, return them. If none are correct but you are certain of the right verse from your own knowledge, return that instead — but only if you are genuinely certain (confidence 0.9+).

Return ONLY a JSON array of the top 3 matches. Shape:
[
  {"surah_number": <1-114>, "verse_number": <int>, "confidence": <0.0-1.0>, "reason": "<one sentence, plain text>"}
]

Confidence scale:
- 0.9+ = this is almost certainly the verse (famous story, unique phrase, unmistakable reference)
- 0.6-0.89 = strong candidate, good match on multiple dimensions
- 0.3-0.59 = plausible, partial match
- below 0.3 = do not return

Rules:
- NEVER fabricate a reference. If unsure, return fewer than 3. If you genuinely cannot find any match above 0.3 confidence, return an empty array [].
- Always verify the surah and verse number you cite actually contains what the user described. Do not guess numbers.
- Prefer precision over popularity — the most famous verse on a topic is not always the one being remembered.
- Return the array and nothing else. No prose. No markdown. No backticks around the JSON.
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

// ── Dataset cache ───────────────────────────────────────────────────────
let versesCache: RawVerse[] | null = null;

async function loadVerses(): Promise<RawVerse[]> {
  if (versesCache) return versesCache;
  const p = path.join(process.cwd(), "public", "data", "verses.json");
  const raw = await readFile(p, "utf-8");
  versesCache = JSON.parse(raw) as RawVerse[];
  return versesCache;
}

/** Verse bounds for validation: surah → max ayah */
const STOP = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by",
  "from","was","is","are","were","been","be","have","has","had","do","does",
  "did","will","would","could","should","may","might","shall","can","it","its",
  "they","he","she","we","i","you","them","him","her","us","my","your","his",
  "our","their","this","that","these","those","there","then","than","as","so",
  "if","not","no","about","even","also","just","only","who","what","when",
  "where","how","why","which","very","more","some","such","all","any","into",
  "out","up","down","after","before","over","under","through","upon","among",
]);

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/**
 * Fast text match over all verses. Returns top-N by token overlap score.
 * Also handles Arabic transliteration fragments and surah names.
 */
function findCandidates(verses: RawVerse[], query: string, topN = 5): RawVerse[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  // Also check surah names
  const queryLower = query.toLowerCase();

  const scored: { verse: RawVerse; score: number }[] = [];
  for (const v of verses) {
    const text = v.translation.toLowerCase();
    const surahLower = v.surahName.toLowerCase();

    let score = 0;
    for (const t of tokens) {
      if (text.includes(t)) score += 1;
      // Partial surah name match gives a bonus
      if (surahLower.includes(t)) score += 0.5;
    }
    // Phrase bonus: if multi-word phrase appears verbatim
    if (tokens.length >= 2 && text.includes(queryLower)) score += 2;

    if (score > 0) scored.push({ verse: v, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map((s) => s.verse);
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

async function askClaude(
  key: string,
  query: string,
  candidates: RawVerse[],
  retryHint: string | null,
): Promise<DetectiveMatch[] | null> {
  const candidateBlock =
    candidates.length > 0
      ? `\n\nThe closest verses found by text search are:\n${candidates
          .map(
            (v, i) =>
              `${i + 1}. ${v.surahName} ${v.surah}:${v.ayah} — "${v.translation.slice(0, 120)}${v.translation.length > 120 ? "…" : ""}"`,
          )
          .join("\n")}\n\nEvaluate these candidates first. Return the best matches, or a different verse if you are certain it is more accurate.`
      : "";

  const userContent = retryHint
    ? `${query}${candidateBlock}\n\n(Previous attempt returned references that did not match a real verse — be more careful with numbering. ${retryHint})`
    : `${query}${candidateBlock}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 600,
      temperature: 0.4,
      system: SYSTEM,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    console.error("reflect anthropic", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  const raw =
    Array.isArray(data.content) && data.content[0]?.type === "text"
      ? (data.content[0].text as string)
      : "";
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

async function validate(
  matches: DetectiveMatch[],
  verses: RawVerse[],
): Promise<ValidatedMatch[]> {
  const boundsMap = new Map<number, number>();
  for (const v of verses) {
    const cur = boundsMap.get(v.surah) ?? 0;
    if (v.ayah > cur) boundsMap.set(v.surah, v.ayah);
  }

  const good: ValidatedMatch[] = [];
  for (const m of matches) {
    const surah = m.surah_number;
    const ayah = m.verse_number;
    const max = boundsMap.get(surah);
    if (!max || ayah < 1 || ayah > max) continue;
    if (m.confidence < 0.3) continue;
    good.push({
      surah,
      ayah,
      confidence: Math.max(0, Math.min(1, m.confidence)),
      reason: stripMarkdown(m.reason),
    });
  }
  good.sort((a, b) => b.confidence - a.confidence);
  return good.slice(0, 3);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query =
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

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return NextResponse.json({ error: "Server is missing ANTHROPIC_API_KEY" }, { status: 500 });
    }

    // Load verses and find text-match candidates to ground Claude's response.
    const verses = await loadVerses();
    const candidates = findCandidates(verses, query.trim(), 5);

    // First pass
    let matches = await askClaude(key, query.trim(), candidates, null);
    let validated = matches ? await validate(matches, verses) : [];

    // Retry once if nothing survived validation
    if (validated.length === 0) {
      const invalid = (matches ?? [])
        .map((m) => `${m.surah_number}:${m.verse_number}`)
        .join(", ");
      const hint = invalid
        ? `Avoid these invalid refs: ${invalid}.`
        : "Double-check your numbering against the candidate list.";
      matches = await askClaude(key, query.trim(), candidates, hint);
      validated = matches ? await validate(matches, verses) : [];
    }

    if (validated.length === 0) {
      return NextResponse.json(
        {
          matches: [],
          message: "Nothing strong came up. Try a different angle — a specific phrase, a story, a name.",
        },
        { status: 200 },
      );
    }

    return NextResponse.json({ matches: validated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("reflect route error", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkRateLimit, getCallerId } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Verse Detective, grounded in local dataset.
 *
 * Before asking Claude, we run a lightweight text-match pass over all 6236
 * verses to find the top 5 candidates. Those candidates (with surah name,
 * number, and translation snippet) are injected into the Claude prompt.
 * This grounds the model's response in real verse data rather than relying on
 * its memory alone. Claude then picks the best match from the candidates, or
 * returns a different verse if it is certain. Every returned reference is
 * validated against the local dataset before we send it back.
 */

const SYSTEM = `You are a Quran verse detective. The user will describe a verse, a story, a historical context, a feeling, or anything they remember, sometimes vague, sometimes a fragment of Arabic or transliteration, sometimes a theme. Your job: identify the most likely verse or verses being referenced.

Search across: literal meaning, tafsir tradition (Ibn Kathir, Al-Tabari, As-Sa'di, Ar-Razi), asbab al-nuzul (occasions of revelation), themes, and the stories of prophets.

You will be given up to 15 candidate verses found by text search. These are your primary candidates. Evaluate them carefully against the user's description. If one or more are strong matches, return them. If none are correct but you are certain of the right verse from your own knowledge, return additional matches, but only if you are genuinely certain (confidence 0.9+).

IMPORTANT, ROTATION: You may be given a list of already-shown verse references to EXCLUDE. Do NOT return any verse in that exclusion list. The user wants to discover new verses, not see the same ones again. If all obvious matches are excluded, find the next-best matches from across the Quran.

Return ALL plausible matches above 0.3 confidence, up to 10 matches, ordered by confidence descending. Do NOT artificially limit to 3, if the query matches many verses (e.g. "say" appears in dozens of verses), return all of them. Shape:
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
- Prefer precision over popularity, the most famous verse on a topic is not always the one being remembered.
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

// ── Dataset cache ────────────────────────────────────────────────────────
let versesCache: RawVerse[] | null = null;

async function loadVerses(): Promise<RawVerse[]> {
 if (versesCache) return versesCache;
 const p = path.join(process.cwd(), "public", "data", "verses.json");
 const raw = await readFile(p, "utf-8");
 versesCache = JSON.parse(raw) as RawVerse[];
 return versesCache;
}

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
function findCandidates(verses: RawVerse[], query: string, topN = 15): RawVerse[] {
 const tokens = tokenize(query);
 if (tokens.length === 0) return [];

 const queryLower = query.toLowerCase();
 const scored: { verse: RawVerse; score: number }[] = [];

 for (const v of verses) {
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

type ExcludeRef = { surah: number; ayah: number };

async function askClaude(
 key: string,
 query: string,
 candidates: RawVerse[],
 retryHint: string | null,
 exclude: ExcludeRef[] = [],
): Promise<DetectiveMatch[] | null> {
 const candidateBlock =
 candidates.length > 0
 ? `\n\nThe closest verses found by text search (up to 15 candidates):\n${candidates
 .map(
 (v, i) =>
 `${i + 1}. ${v.surahName} ${v.surah}:${v.ayah}, "${v.translation.slice(0, 120)}${v.translation.length > 120 ? "…" : ""}"`,
 )
 .join("\n")}\n\nEvaluate these candidates first. Return the best matches, or a different verse if you are certain it is more accurate.`
 : "";

 const excludeBlock =
 exclude.length > 0
 ? `\n\nDo NOT return any of these already-shown verses, the user has seen them and wants new ones: ${exclude.map((e) => `${e.surah}:${e.ayah}`).join(", ")}.`
 : "";

 const userContent = retryHint
 ? `${query}${candidateBlock}${excludeBlock}\n\n(Previous attempt returned references that did not match a real verse, be more careful with numbering. ${retryHint})`
 : `${query}${candidateBlock}${excludeBlock}`;

 const res = await fetch("https://api.anthropic.com/v1/messages", {
 method: "POST",
 headers: {
 "x-api-key": key,
 "anthropic-version": "2023-06-01",
 "content-type": "application/json",
 },
 body: JSON.stringify({
 model: "claude-sonnet-4-5",
 max_tokens: 800,
 temperature: 0.4,
 system: SYSTEM,
 messages: [{ role: "user", content: userContent }],
 }),
 });

 if (!res.ok) {
 const text = await res.text().catch(() => "");
 if (/credit balance|credit_balance|invalid_request_error.*credit|authentication_error|invalid x-api-key/i.test(text)) {
 throw new Error("__AI_PAUSED__");
 }
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
 // Build surah → max ayah bounds from the real dataset
 const boundsMap = new Map<number, number>();
 for (const v of verses) {
 const cur = boundsMap.get(v.surah) ?? 0;
 if (v.ayah > cur) boundsMap.set(v.surah, v.ayah);
 }

 const good: ValidatedMatch[] = [];
 for (const m of matches) {
 const surah = m.surah_number;
 const ayah = m.verse_number;
 // Must be integers within real dataset bounds
 if (
 !Number.isInteger(surah) || surah < 1 || surah > 114 ||
 !Number.isInteger(ayah) || ayah < 1
 ) continue;
 const max = boundsMap.get(surah);
 if (!max || ayah > max) continue;
 if (m.confidence < 0.3) continue;
 good.push({
 surah,
 ayah,
 confidence: Math.max(0, Math.min(1, m.confidence)),
 reason: stripMarkdown(m.reason).slice(0, 300), // cap reason length
 });
 }
 good.sort((a, b) => b.confidence - a.confidence);
 return good.slice(0, 10);
}

export async function POST(req: NextRequest) {
 // ── Rate limit: 20 req / 60 s per IP ──────────────────────────────────
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
 return NextResponse.json({ error: "Service temporarily unavailable." }, { status: 503 });
 }

 // Parse exclude list: array of {surah, ayah} sent by client to skip already-seen verses
 const excludeRaw: unknown[] = Array.isArray(body?.exclude) ? body.exclude : [];
 const exclude: ExcludeRef[] = excludeRaw
 .filter(
 (e): e is ExcludeRef =>
 !!e &&
 typeof e === "object" &&
 typeof (e as ExcludeRef).surah === "number" &&
 typeof (e as ExcludeRef).ayah === "number",
 )
 .slice(0, 80); // cap to keep prompt size reasonable

 const verses = await loadVerses();
 const candidates = findCandidates(verses, query.trim(), 15);

 // First pass
 let matches = await askClaude(key, query.trim(), candidates, null, exclude);
 let validated = matches ? await validate(matches, verses) : [];

 // Retry once if nothing survived validation
 if (validated.length === 0) {
 const invalid = (matches ?? [])
 .map((m) => `${m.surah_number}:${m.verse_number}`)
 .join(", ");
 const hint = invalid
 ? `Avoid these invalid refs: ${invalid}.`
 : "Double-check your numbering against the candidate list.";
 matches = await askClaude(key, query.trim(), candidates, hint, exclude);
 validated = matches ? await validate(matches, verses) : [];
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
 if (err instanceof Error && err.message === "__AI_PAUSED__") {
 return NextResponse.json(
 { matches: [], paused: true, error: "AI commentary is paused — between API top-ups." },
 { status: 503 },
 );
 }
 return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
 }
}

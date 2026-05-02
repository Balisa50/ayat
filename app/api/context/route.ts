import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getCallerId } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Strictly grounded Quranic context generator.
 *
 * Every claim is rooted in classical tafsir: Ibn Kathir, Al-Tabari, Al-Qurtubi,
 * Al-Jalalayn, Ar-Razi, As-Sa'di. Zero fabrication. Zero extrapolation.
 * Integrity over completeness, silence beats a wrong statement.
 *
 * Output format (five labelled sections, plain text only):
 * SCENE, asbab al-nuzul or documented period/setting
 * MEANING, what the verse actually says, Arabic precision
 * HITS, classical scholarly linguistic/theological depth, scholar named
 * REFLECT, one question from the verse's own language or theology
 * NEXT, one related verse reference with scholarly reason
 */
const SYSTEM = `You are a strict Quranic content generator. You only state what is established in classical tafsir sources, primarily Ibn Kathir, Al-Tabari, Al-Qurtubi, and Al-Jalalayn. Never invent, extrapolate or assume. If you are not certain about a scholarly attribution, do not include it. If you have nothing grounded to say about a specific aspect, say less rather than risk fabrication.

Return EXACTLY five labelled sections in this order, nothing else:

SCENE: State only the historically documented context of revelation (asbab al-nuzul) if it exists. If no specific occasion of revelation is recorded, state the general period and setting plainly. Never dramatize beyond what is documented.

MEANING: One to two sentences on what the verse actually says. Explain the Arabic grammatical structure or word choice if it carries weight. Be precise. Avoid paraphrase that flattens the original.

HITS: Explain only what classical Arabic linguists and scholars specifically noted about this verse's language, word choices or structure. Reference the scholar by name. If no specific scholarly commentary exists on the linguistic depth, explain the literal Arabic meaning of key words only.

REFLECT: Write one question that emerges directly from the verse's documented meaning or its scholarly commentary. The question must be about the verse itself, its language, theology or historical context. Never write life-coaching prompts. Maximum fifteen words.

NEXT: One related verse in the form "Surah:Ayah · short scholarly reason."

Tone: You may be warm and occasionally carry gentle wit where appropriate, the great scholars were not dry robots. When a verse carries inherent irony or drama, let that breathe naturally. Iblis arguing the chemistry of fire versus clay when Allah commanded him to bow is not invented drama, it is what the verse itself records, and noting that he missed the point entirely by diving into elemental hierarchies is fair scholarly wit. That kind of humor must always emerge FROM the verse, never imposed onto it. Some verses are heavy (death, judgment, mercy), those stay serious and measured. Some verses carry inherent irony baked in, those can carry quiet scholarly humor. Read the verse first. Let the tone follow the verse. Never the other way around.

HARD RULES:
- Plain text only. No markdown. No asterisks. No bullets. No emojis.
- ABSOLUTELY NO em-dashes (, ) or en-dashes (, ) anywhere in the output. Use commas, parentheses, or full stops instead. This rule has no exceptions.
- Never invent hadith or scholarly citations. If no specific tafsir applies, note the linguistic feature directly.
- Do not restate the translation.
- Under 160 words total across all five sections.
- If uncertain: say nothing rather than guess. Integrity over completeness. One wrong statement about the Quran is worse than ten boring correct ones.

BANNED phrases, using any of these is a failure:
- "reminds us" / "teaches us" / "encourages us" / "speaks to us"
- "reflects" / "embodies" / "captures"
- Generic spiritual language not grounded in this specific verse
- Motivational or self-help framing of any kind`;

/** Strip any markdown or unicode dashes the model sneaks in. */
function stripMarkdown(s: string): string {
 return s
 .replace(/\*\*([^*]+)\*\*/g, "$1")
 .replace(/\*([^*]+)\*/g, "$1")
 .replace(/`([^`]+)`/g, "$1")
 .replace(/^#+\s*/gm, "")
 .replace(/^\s*[-•]\s+/gm, "")
 .replace(/\*/g, "")
 // Replace every Unicode dash variant the model might emit with a
 // comma plus space. Em-dashes and en-dashes look AI-generated;
 // commas read naturally. This is the prompt's HARD RULE enforced
 // server-side as a guarantee. Using \u escapes so future
 // dash-stripping passes can't accidentally damage this regex.
 .replace(/\s*[\u2014\u2013\u2012\u2015\u2212]\s*/g, ", ")
 .replace(/[ \t]{2,}/g, " ")
 .replace(/\s+,/g, ",")
 .trim();
}

/** Validate that a value looks like a Quran verse reference. */
function isValidRef(surah: unknown, ayah: unknown): boolean {
 return (
 typeof surah === "number" &&
 Number.isInteger(surah) &&
 surah >= 1 &&
 surah <= 114 &&
 typeof ayah === "number" &&
 Number.isInteger(ayah) &&
 ayah >= 1 &&
 ayah <= 286 // longest surah (Al-Baqarah) has 286 verses
 );
}

export async function POST(req: NextRequest) {
 // ── Rate limit: 40 req / 60 s per IP ──────────────────────────────────
 const rl = checkRateLimit(getCallerId(req.headers), 40, 60_000);
 if (!rl.ok) {
 return NextResponse.json(
 { context: null },
 {
 status: 429,
 headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
 },
 );
 }

 try {
 const body = await req.json();
 const { arabic, translation, surahName, ayah, surah } = body ?? {};

 // ── Input validation ───────────────────────────────────────────────
 if (
 typeof arabic !== "string" || arabic.length > 2000 ||
 typeof translation !== "string" || translation.length > 2000 ||
 typeof surahName !== "string" || surahName.length > 100 ||
 !isValidRef(surah, ayah)
 ) {
 return NextResponse.json({ context: null }, { status: 400 });
 }

 const key = process.env.ANTHROPIC_API_KEY;
 if (!key) {
 return NextResponse.json({ context: null }, { status: 503 });
 }

 const userContent = `Surah ${surahName} (${surah}), Verse ${ayah}

Arabic: ${arabic}

Translation: ${translation}

Write the five sections. Plain text only, no asterisks, no markdown.`;

 const res = await fetch("https://api.anthropic.com/v1/messages", {
 method: "POST",
 headers: {
 "x-api-key": key,
 "anthropic-version": "2023-06-01",
 "content-type": "application/json",
 },
 body: JSON.stringify({
 model: "claude-sonnet-4-5",
 max_tokens: 700,
 system: SYSTEM,
 messages: [{ role: "user", content: userContent }],
 }),
 });

 if (!res.ok) {
 return NextResponse.json({ context: null }, { status: 502 });
 }

 const data = await res.json();
 const raw =
 Array.isArray(data.content) && data.content[0]?.type === "text"
 ? (data.content[0].text as string)
 : "";

 return NextResponse.json({ context: stripMarkdown(raw) });
 } catch {
 return NextResponse.json({ context: null }, { status: 500 });
 }
}

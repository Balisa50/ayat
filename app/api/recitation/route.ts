import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getCallerId } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// This route had no duration cap at all, so a stalled upstream ran to the
// platform default before anything gave up.
export const maxDuration = 15;

// Comfortably inside maxDuration so a timeout returns a real status rather
// than the platform terminating the function.
const UPSTREAM_TIMEOUT_MS = 8_000;

/**
 * /api/recitation?reciter=<id>&ayah=<surah>:<ayah>
 *
 * Two audio sources:
 *
 * 1. Quran.com v4 (numeric IDs 1-12):
 *    https://api.quran.com/api/v4/recitations/{id}/by_ayah/{surah}:{ayah}
 *    Returns audio URL + word-level timing segments.
 *    Verified IDs:
 *      1  - AbdulBaset AbdulSamad (Mujawwad)
 *      2  - AbdulBaset AbdulSamad (Murattal)
 *      3  - Abdur-Rahman As-Sudais
 *      4  - Abu Bakr Al-Shatri
 *      5  - Hani Ar-Rifai
 *      6  - Mahmoud Khalil Al-Husary
 *      7  - Mishari Rashid Al-Afasy  (default)
 *      8  - Mohamed Siddiq Al-Minshawi (Mujawwad)
 *      9  - Mohamed Siddiq Al-Minshawi (Murattal)
 *      10 - Sa'ud Ash-Shuraym
 *
 * 2. EveryAyah CDN (special string IDs):
 *    For reciters not on Quran.com v4 (e.g. Saad Al-Ghamdi, Maher Al-Muaiqly).
 *    No word-level segments - word highlighting disabled for these.
 *    Format: https://mirrors.quranicaudio.com/everyayah/{folder}/SSSAAA.mp3
 */

// Map of special reciter keys → everyayah CDN folder names.
// All verified 200 OK against everyayah.com/data/{folder}/001001.mp3
const CDN_RECITERS: Record<string, string> = {
  // Original two
  ghamdi:    "Ghamadi_40kbps",
  muaiqly:   "MaherAlMuaiqly128kbps",
  // New additions - all confirmed available
  ayyoub:    "Muhammad_Ayyoub_128kbps",
  dossari:   "Yasser_Ad-Dussary_128kbps",
  qatami:    "Nasser_Alqatami_128kbps",
  jibreel:   "Muhammad_Jibreel_128kbps",
  juhany:    "Abdullaah_3awwaad_Al-Juhaynee_128kbps",
  hudhaify:  "Hudhaify_128kbps",
  basfar:    "Abdullah_Basfar_192kbps",
  budair:    "Salah_Al_Budair_128kbps",
  // Note: Bandar Baleela and Idris Abkar are not on any confirmed public CDN.
};

function zeroPad(n: number, len: number): string {
  return String(n).padStart(len, "0");
}

export async function GET(req: NextRequest) {
  // ── Rate limit: 120 req / 60 s per IP (audio fetches happen on every verse open) ──
  const rl = checkRateLimit(getCallerId(req.headers), 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const sp = new URL(req.url).searchParams;
  const reciter = sp.get("reciter") ?? "7";
  const ayah = sp.get("ayah");

  if (!ayah || !/^\d+:\d+$/.test(ayah)) {
    return NextResponse.json({ error: "bad ayah" }, { status: 400 });
  }

  const [surahStr, ayahStr] = ayah.split(":");
  const surahNum = parseInt(surahStr, 10);
  const ayahNum = parseInt(ayahStr, 10);

  // Validate surah/ayah ranges before hitting upstream
  if (surahNum < 1 || surahNum > 114 || ayahNum < 1 || ayahNum > 286) {
    return NextResponse.json({ error: "out of range" }, { status: 400 });
  }

  // ── CDN path (Ghamdi, Muaiqly, etc.) ──────────────────────────────
  if (reciter in CDN_RECITERS) {
    const folder = CDN_RECITERS[reciter];
    const filename = `${zeroPad(surahNum, 3)}${zeroPad(ayahNum, 3)}.mp3`;
    const rawAudio = `https://everyayah.com/data/${folder}/${filename}`;
    const audioUrl = `/api/audio?u=${encodeURIComponent(rawAudio)}`;
    // No timing segments from CDN - word highlighting disabled.
    return NextResponse.json({ audioUrl, segments: [] });
  }

  // ── Quran.com v4 path ──────────────────────────────────────────────
  if (!/^\d+$/.test(reciter)) {
    return NextResponse.json({ error: "unknown reciter" }, { status: 400 });
  }

  try {
    const url = `https://api.quran.com/api/v4/recitations/${reciter}/by_ayah/${ayah}`;
    // quran.com is a third party with no availability guarantee to this app.
    // Without a deadline a stalled response holds the function open until the
    // platform kills it, and the player waits on a lookup that is never coming
    // back. Eight seconds is generous for a single metadata call.
    const res = await fetch(url, {
      next: { revalidate: 60 * 60 * 24 * 7 },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `quran.com ${res.status}` },
        { status: 502 }
      );
    }
    const data = await res.json();
    const file = data.audio_files?.[0];
    if (!file || typeof file.url !== "string") {
      return NextResponse.json({ error: "no audio" }, { status: 404 });
    }

    // Quran.com returns protocol-relative URLs like //mirrors.quranicaudio.com/...
    // Must normalise to https before passing to the audio proxy.
    const rawAudio: string = file.url.startsWith("http")
      ? file.url
      : file.url.startsWith("//")
        ? `https:${file.url}`
        : `https://audio.qurancdn.com/${file.url}`;

    // Route through /api/audio so MediaElementAudioSourceNode can
    // capture the stream without CORS issues.
    const audioUrl = `/api/audio?u=${encodeURIComponent(rawAudio)}`;

    return NextResponse.json({
      audioUrl,
      // segments: 4-tuples [wordStart, wordEnd, startMs, endMs] or
      //           3-tuples [wordIndex, startMs, endMs]. Client handles both.
      segments: file.segments ?? [],
    });
  } catch (err) {
    // A timeout is an upstream availability problem, not a bug here, and 504
    // says so. Collapsing it into a 500 hides the difference from anyone
    // reading logs later.
    if (err instanceof Error && err.name === "TimeoutError") {
      return NextResponse.json({ error: "quran.com timed out" }, { status: 504 });
    }
    return NextResponse.json({ error: "upstream error" }, { status: 500 });
  }
}

import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * /api/audio?u=<encoded-url>
 *
 * Stream-proxy for recitation audio files. Exists so the browser's
 * MediaElementAudioSourceNode can capture the audio stream cleanly for
 * video recording - remote CDNs occasionally return CORS headers that
 * taint the audio context and silence the recorded track.
 *
 * Only a tight allow-list of hosts is proxied.
 */

const ALLOWED_HOSTS = new Set([
  "audio.qurancdn.com",
  "verses.quran.com",
  "cdn.islamic.network",
  "everyayah.com",
  "download.quranicaudio.com",
  "mirrors.quranicaudio.com",
  "quranicaudio.com",
]);

/** Upstream must return audio/* or application/octet-stream (some CDNs do this). */
function isAudioContentType(ct: string | null): boolean {
  if (!ct) return false;
  const lower = ct.toLowerCase().split(";")[0].trim();
  return lower.startsWith("audio/") || lower === "application/octet-stream";
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url).searchParams.get("u");
  if (!u) return new Response("missing url", { status: 400 });

  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return new Response("bad url", { status: 400 });
  }

  // Enforce HTTPS - no plain-HTTP audio proxying
  if (target.protocol !== "https:") {
    return new Response("https required", { status: 400 });
  }

  if (!ALLOWED_HOSTS.has(target.hostname)) {
    return new Response("host not allowed", { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: { "User-Agent": "AYAT/1.0 (+https://ayat.app)" },
    });
  } catch {
    return new Response("upstream unreachable", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response("upstream error", { status: 502 });
  }

  // Validate the upstream is actually sending audio
  const upstreamCT = upstream.headers.get("Content-Type");
  if (!isAudioContentType(upstreamCT)) {
    return new Response("upstream returned non-audio content", { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstreamCT ?? "audio/mpeg",
      "Cache-Control": "public, max-age=604800, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

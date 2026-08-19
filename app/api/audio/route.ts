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

  // Forward the browser's Range header. A media element asks for byte ranges
  // to work out duration and to seek, and it expects a 206 back. This proxy
  // used to swallow the header and answer every request with the whole file
  // and a bare 200, with no Accept-Ranges and no Content-Length. Chrome
  // tolerates that; Firefox does not, and playback simply never started.
  const range = req.headers.get("range");

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: {
        "User-Agent": "AYAT/1.0 (+https://ayat-ab.vercel.app)",
        ...(range ? { Range: range } : {}),
      },
    });
  } catch {
    return new Response("upstream unreachable", { status: 502 });
  }

  // 206 is the expected answer to a range request, so it is a success too.
  if ((!upstream.ok && upstream.status !== 206) || !upstream.body) {
    return new Response("upstream error", { status: 502 });
  }

  // Validate the upstream is actually sending audio
  const upstreamCT = upstream.headers.get("Content-Type");
  if (!isAudioContentType(upstreamCT)) {
    return new Response("upstream returned non-audio content", { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": upstreamCT ?? "audio/mpeg",
    "Cache-Control": "public, max-age=604800, immutable",
    "Access-Control-Allow-Origin": "*",
    // Advertise range support even when this particular response is whole,
    // otherwise the player never tries to seek.
    "Accept-Ranges": "bytes",
  });

  // Pass the length and the range window straight through when the upstream
  // gave them, so the player can show a real duration and scrub.
  const len = upstream.headers.get("Content-Length");
  if (len) headers.set("Content-Length", len);
  const contentRange = upstream.headers.get("Content-Range");
  if (contentRange) headers.set("Content-Range", contentRange);

  return new Response(upstream.body, {
    status: upstream.status === 206 ? 206 : 200,
    headers,
  });
}

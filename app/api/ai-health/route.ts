import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getCallerId } from "@/lib/rate-limit";
import { healthReport } from "@/lib/ai-pipeline";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Which providers are configured, and which are actually answering.
 *
 * This exists because the last outage was invisible. The commentary stopped
 * working, the galaxy kept working, and there was no way to tell from outside
 * whether the key was missing, the free tier had said no, or the host was
 * down. Now there is one URL that answers that question.
 *
 * It reports configuration state and reachability, never key material. A
 * provider with no key reads as "not configured", which is a deployment fact
 * worth being able to see, not a secret.
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(getCallerId(req.headers), 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const providers = await healthReport();
  const usable = providers.filter((p) => p.configured && p.ok);

  return NextResponse.json(
    {
      ok: usable.length > 0,
      // The number that matters. One healthy provider is a working service;
      // one healthy provider out of four is a working service that is one bad
      // morning away from not being one.
      healthy: usable.length,
      configured: providers.filter((p) => p.configured).length,
      providers,
      checkedAt: new Date().toISOString(),
    },
    {
      status: usable.length > 0 ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

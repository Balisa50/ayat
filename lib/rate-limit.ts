/**
 * Lightweight in-memory rate limiter.
 *
 * Designed for Next.js Edge / Node serverless - works per-instance.
 * Good enough for Anthropic API cost-protection on a single-region
 * Vercel deployment. Swap for Redis/Vercel KV if you need cross-instance
 * coordination at scale.
 */

type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();

/**
 * Returns { ok: true } if the request is within quota,
 * { ok: false } if the bucket is full.
 *
 * @param id        Unique caller key (e.g. IP address)
 * @param max       Max requests per window
 * @param windowMs  Window length in milliseconds
 */
export function checkRateLimit(
  id: string,
  max: number,
  windowMs: number,
): { ok: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  let bucket = store.get(id);

  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    store.set(id, bucket);
  }

  if (bucket.count >= max) {
    return { ok: false, remaining: 0, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count++;
  return { ok: true, remaining: max - bucket.count, retryAfterMs: 0 };
}

/**
 * Extract a best-effort caller identifier from request headers.
 * Prefers the first X-Forwarded-For entry (set by Vercel's edge network),
 * falls back to X-Real-IP, then to the literal string "unknown".
 */
export function getCallerId(headers: { get(name: string): string | null }): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}

// ── Convenience: stale bucket GC (call once per cold-start if memory matters) ──
export function pruneStore(): void {
  const now = Date.now();
  for (const [key, bucket] of store) {
    if (now > bucket.resetAt) store.delete(key);
  }
}

import { NextResponse } from "next/server";
import { healthReport } from "@/lib/ai-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Visit this when the app says "AI unavailable". It tells you which provider's
 * key is dead, which one is alive, and which circuit breakers are open.
 *
 * No auth. The endpoint never returns the key itself, only whether it works.
 */
export async function GET() {
  const report = await healthReport();
  const anyAlive = report.some((p) => p.ok);
  return NextResponse.json(
    {
      ok: anyAlive,
      summary: anyAlive
        ? `${report.filter((p) => p.ok).length} of ${report.length} providers responding`
        : "All providers down. Refresh at least one API key.",
      providers: report
    },
    { status: anyAlive ? 200 : 503 }
  );
}

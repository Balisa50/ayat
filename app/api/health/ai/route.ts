import { NextResponse } from "next/server";
import { healthReport, chat, AiUnavailableError } from "@/lib/ai-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Visit this when the app says the AI is paused. It tells you which provider's
 * key is dead, which is alive, and — if you pass ?call=1 — it actually runs a
 * one-token completion and returns the raw error if it fails.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const runCall = url.searchParams.get("call") === "1";

  const report = await healthReport();
  const anyAlive = report.some((p) => p.ok);

  let liveCall: unknown = null;
  if (runCall) {
    try {
      const result = await chat({
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        maxTokens: 5,
        timeoutMs: 15_000,
        deadlineMs: 25_000,
        attemptsPerModel: 1
      });
      liveCall = {
        ok: true,
        provider: result.provider,
        model: result.model,
        ms: result.ms,
        attempts: result.attempts,
        text: result.text
      };
    } catch (e) {
      if (e instanceof AiUnavailableError) {
        liveCall = {
          ok: false,
          attempts: e.attempts,
          tried: e.tried,
          diagnostics: e.diagnostics
        };
      } else {
        liveCall = {
          ok: false,
          error: e instanceof Error ? e.message : String(e)
        };
      }
    }
  }

  return NextResponse.json(
    {
      ok: anyAlive,
      summary: anyAlive
        ? `${report.filter((p) => p.ok).length} of ${report.length} providers responding`
        : "All providers down. Refresh at least one API key.",
      providers: report,
      liveCall
    },
    { status: 200 }
  );
}

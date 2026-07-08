// NVIDIA NIM client (OpenAI-compatible). AYAT moved its grounded-tafsir and
// verse-detective calls off the paid Anthropic API onto NVIDIA's free endpoint.
// Leads with NVIDIA_MODEL and falls back down a chain of free models (retrying
// transient errors) so a flaky response or a model deprecation degrades
// gracefully instead of failing the request.
// Set NVIDIA_API_KEY in the environment; NVIDIA_MODEL is optional.

const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";
export const NVIDIA_MODEL =
  process.env.NVIDIA_MODEL || "mistralai/mistral-medium-3.5-128b";

// Model chain, tried in order. Primary is env-overridable; the rest are free
// NVIDIA fallbacks. A model deprecation becomes a 1-line env fix, not an outage.
const NVIDIA_MODELS: string[] = [
  NVIDIA_MODEL,
  "deepseek-ai/deepseek-v4-flash",
].filter((m, i, a) => m && a.indexOf(m) === i);

export type ChatMessage = { role: string; content: string };

interface CallOpts {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isTransient = (status: number) => status === 429 || status >= 500;

/**
 * One-shot completion with model fallback + per-model retry. Walks NVIDIA_MODELS,
 * retrying a transient failure on the same model once before dropping to the
 * next. Only throws once every model is exhausted.
 */
export async function nvidiaChat(opts: CallOpts): Promise<string> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY is not set");

  const messages = opts.system
    ? [{ role: "system", content: opts.system }, ...opts.messages]
    : opts.messages;

  let lastErr = "";
  for (const model of NVIDIA_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: opts.maxTokens ?? 1024,
            temperature: opts.temperature ?? 0.7,
          }),
        });
      } catch (e) {
        lastErr = `network: ${e instanceof Error ? e.message : String(e)}`;
        if (attempt === 0) { await sleep(400); continue; }
        break;
      }
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content ?? "";
        if (text) return text;
        lastErr = `empty response from ${model}`;
        break; // empty → next model
      }
      lastErr = `NVIDIA API ${res.status} (${model}): ${(await res.text().catch(() => "")).slice(0, 200)}`;
      if (isTransient(res.status) && attempt === 0) { await sleep(500); continue; }
      break; // non-transient or retried → next model
    }
  }
  throw new Error(`NVIDIA API error after all models: ${lastErr}`);
}

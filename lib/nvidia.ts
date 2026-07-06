// NVIDIA NIM client (OpenAI-compatible). AYAT moved its grounded-tafsir and
// verse-detective calls off the paid Anthropic API onto NVIDIA's free endpoint.
// Set NVIDIA_API_KEY in the environment; NVIDIA_MODEL is optional.

const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";
export const NVIDIA_MODEL =
  process.env.NVIDIA_MODEL || "mistralai/mistral-medium-3.5-128b";

export type ChatMessage = { role: string; content: string };

interface CallOpts {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

/** One-shot completion. Returns the assistant text; throws on a non-200. */
export async function nvidiaChat(opts: CallOpts): Promise<string> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY is not set");

  const messages = opts.system
    ? [{ role: "system", content: opts.system }, ...opts.messages]
    : opts.messages;

  const res = await fetch(`${NVIDIA_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
    }),
  });
  if (!res.ok) {
    throw new Error(`NVIDIA API error: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

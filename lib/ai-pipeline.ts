/**
 * Provider-agnostic chat pipeline.
 *
 * AYAT used to call one provider through lib/nvidia.ts. That file already had
 * a model chain and a retry, which is why most failures degraded quietly, but
 * every model in the chain sat behind a single API key on a single host. When
 * the key was missing in the deployment environment, or the free tier said no,
 * or the host had a bad ten minutes, the whole chain failed together. A chain
 * of models is not a fallback if they share the thing that breaks.
 *
 * This walks providers first and models second. Every provider here speaks the
 * OpenAI /chat/completions shape, so one request implementation covers all of
 * them and adding a fifth is a table entry rather than a client.
 *
 * Three rules that shaped it:
 *
 * 1. A provider with no credentials configured is skipped, not attempted. A
 *    dead link in the chain costs a timeout on every single request and hides
 *    the real error behind the last one.
 * 2. Health checks are cached and consulted only for providers the circuit
 *    breaker has already tripped. Probing every provider before every call
 *    would double the latency of the path that was working fine.
 * 3. The whole walk is bounded by one deadline. The caller runs inside a
 *    function budget, and a fallback chain that exceeds it has converted a
 *    partial failure into a total one.
 *
 * Deliberately dependency-free and free of path aliases, so it can be run
 * directly by scripts/test-ai-pipeline.mjs without a bundler.
 */

export type ChatMessage = { role: string; content: string };

export interface ChatOptions {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Per network attempt. */
  timeoutMs?: number;
  /** Ceiling for the entire walk across every provider, model and retry. */
  deadlineMs?: number;
  /** Attempts per model before moving on. 1 means no retry. */
  attemptsPerModel?: number;
}

export interface ChatResult {
  text: string;
  provider: string;
  model: string;
  /** Network attempts made across the whole walk, including the one that worked. */
  attempts: number;
  ms: number;
  /** Providers and models that failed before this one answered. */
  fellBackFrom: string[];
}

/** What the user sees when nothing answered. Never a stack trace, never a provider name. */
export const AI_UNAVAILABLE_MESSAGE =
  "The commentary service is not responding right now. Everything else on the page still works, and this usually clears within a few minutes.";

export class AiUnavailableError extends Error {
  readonly attempts: number;
  readonly tried: string[];
  /** Provider-by-provider reasons. For logs and the health endpoint, not for users. */
  readonly diagnostics: string[];

  constructor(attempts: number, tried: string[], diagnostics: string[]) {
    super(AI_UNAVAILABLE_MESSAGE);
    this.name = "AiUnavailableError";
    this.attempts = attempts;
    this.tried = tried;
    this.diagnostics = diagnostics;
  }
}

/* ------------------------------------------------------------------ */
/*  Providers                                                          */
/* ------------------------------------------------------------------ */

export interface Provider {
  id: string;
  label: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  /** Ollama is reachable without a key; everything else is not. */
  requiresKey: boolean;
  /** Set when the provider is present in the order but unusable, for diagnostics. */
  disabledReason?: string;
}

const DEFAULT_ORDER = ["nvidia", "groq", "gemini", "openai", "ollama"];

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function dedupe(models: string[]): string[] {
  return models.filter((m, i, a) => m && a.indexOf(m) === i);
}

/**
 * Built per call rather than at module load, so a test (or a route that sets a
 * key at runtime) sees the current environment instead of the one that existed
 * when the module was first imported.
 */
export function buildProviders(env: NodeJS.ProcessEnv = process.env): Provider[] {
  const table: Record<string, Provider> = {
    nvidia: {
      id: "nvidia",
      label: "NVIDIA NIM",
      baseUrl: env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
      apiKey: env.NVIDIA_API_KEY,
      requiresKey: true,
      models: dedupe([
        env.NVIDIA_MODEL || "mistralai/mistral-medium-3.5-128b",
        ...csv(env.NVIDIA_FALLBACK_MODELS),
        "meta/llama-3.3-70b-instruct"
      ])
    },
    groq: {
      id: "groq",
      label: "Groq",
      baseUrl: env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
      apiKey: env.GROQ_API_KEY,
      requiresKey: true,
      models: dedupe([env.GROQ_MODEL || "llama-3.3-70b-versatile"])
    },
    gemini: {
      id: "gemini",
      label: "Gemini",
      // Google publishes an OpenAI-compatible surface, which is the only reason
      // Gemini can share a request implementation with the rest of this table.
      baseUrl: env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
      requiresKey: true,
      models: dedupe([env.GEMINI_MODEL || "gemini-2.0-flash"])
    },
    openai: {
      id: "openai",
      label: "OpenAI",
      baseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      apiKey: env.OPENAI_API_KEY,
      requiresKey: true,
      models: dedupe([env.OPENAI_MODEL || "gpt-4o-mini"])
    },
    ollama: {
      id: "ollama",
      label: "Ollama",
      // No default. Ollama listens on localhost, which a deployed function
      // cannot reach, so an unset base URL must mean "not available here"
      // rather than "try 127.0.0.1 and wait for the timeout".
      baseUrl: env.OLLAMA_BASE_URL || "",
      requiresKey: false,
      models: dedupe([env.OLLAMA_MODEL || "llama3.1"])
    }
  };

  const order = csv(env.AI_PROVIDER_ORDER);
  const ids = order.length > 0 ? order : DEFAULT_ORDER;

  return ids
    .map((id) => table[id])
    .filter((p): p is Provider => Boolean(p))
    .map((p) => {
      if (!p.baseUrl) return { ...p, disabledReason: "no base URL configured" };
      if (p.requiresKey && !p.apiKey) return { ...p, disabledReason: "no API key configured" };
      return p;
    });
}

/** Providers that are actually usable in this environment. */
export function availableProviders(env: NodeJS.ProcessEnv = process.env): Provider[] {
  return buildProviders(env).filter((p) => !p.disabledReason);
}

/* ------------------------------------------------------------------ */
/*  Circuit breaker and health                                         */
/* ------------------------------------------------------------------ */

type BreakerState = { failures: number; openUntil: number };
type HealthEntry = { ok: boolean; checkedAt: number; detail: string };

const breakers = new Map<string, BreakerState>();
const health = new Map<string, HealthEntry>();

/**
 * Complete provider failures before it is skipped for a while.
 *
 * One is deliberate. Reaching recordFailure means every model on the provider
 * has already been tried and retried, so a second full walk before tripping
 * would make the next request pay for the same outage again. The health probe
 * closes the breaker early when the provider comes back, so this is cheap to
 * get wrong in the strict direction and expensive to get wrong in the lax one.
 */
const TRIP_AFTER = 1;
const OPEN_MS = 60_000;
const HEALTH_TTL_MS = 60_000;
const HEALTH_TIMEOUT_MS = 4_000;

function isOpen(id: string): boolean {
  const b = breakers.get(id);
  return Boolean(b && b.openUntil > Date.now());
}

function recordFailure(id: string): void {
  const b = breakers.get(id) ?? { failures: 0, openUntil: 0 };
  b.failures += 1;
  if (b.failures >= TRIP_AFTER) {
    b.openUntil = Date.now() + OPEN_MS;
    b.failures = 0;
  }
  breakers.set(id, b);
}

function recordSuccess(id: string): void {
  breakers.set(id, { failures: 0, openUntil: 0 });
  health.set(id, { ok: true, checkedAt: Date.now(), detail: "answered a real request" });
}

/**
 * Is this provider answering at all?
 *
 * Lists models rather than sending a completion, because listing is free on
 * every provider here and a completion is not. The result is cached, so a
 * provider that is genuinely down is probed about once a minute rather than
 * once a request.
 */
export async function checkProviderHealth(
  provider: Provider,
  force = false
): Promise<{ ok: boolean; detail: string }> {
  if (provider.disabledReason) return { ok: false, detail: provider.disabledReason };

  const cached = health.get(provider.id);
  if (!force && cached && Date.now() - cached.checkedAt < HEALTH_TTL_MS) {
    return { ok: cached.ok, detail: cached.detail };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  let result: { ok: boolean; detail: string };

  try {
    const res = await fetch(`${provider.baseUrl}/models`, {
      method: "GET",
      headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
      signal: controller.signal
    });
    // 401 and 403 mean the host is up and the credentials are wrong, which is
    // still unusable, and worth saying differently in a log.
    result = res.ok
      ? { ok: true, detail: `HTTP ${res.status}` }
      : { ok: false, detail: res.status === 401 || res.status === 403 ? "credentials rejected" : `HTTP ${res.status}` };
  } catch (e) {
    result = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }

  health.set(provider.id, { ...result, checkedAt: Date.now() });
  return result;
}

/** Snapshot for a status route. Forces a fresh probe of every configured provider. */
export async function healthReport(
  env: NodeJS.ProcessEnv = process.env
): Promise<{ id: string; label: string; configured: boolean; ok: boolean; detail: string; breakerOpen: boolean }[]> {
  const providers = buildProviders(env);
  return Promise.all(
    providers.map(async (p) => {
      const h = p.disabledReason
        ? { ok: false, detail: p.disabledReason }
        : await checkProviderHealth(p, true);
      return {
        id: p.id,
        label: p.label,
        configured: !p.disabledReason,
        ok: h.ok,
        detail: h.detail,
        breakerOpen: isOpen(p.id)
      };
    })
  );
}

/** Test seam. Resets breaker and health state between simulated outages. */
export function resetPipelineState(): void {
  breakers.clear();
  health.clear();
}

/* ------------------------------------------------------------------ */
/*  The call                                                           */
/* ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 429 and 5xx are worth trying again. A 400 or a 404 will fail identically forever. */
const isTransient = (status: number) => status === 429 || status >= 500;

/**
 * Credentials were rejected, so every model behind this key will reject too.
 * This is the distinction the first version of the file got wrong: it treated
 * a 401 as a reason to try the provider's next model, which is a guaranteed
 * wasted round trip on the slowest possible path.
 */
const isProviderFatal = (status: number) => status === 401 || status === 403;

/** Exponential, with jitter so parallel callers do not retry in lockstep. */
function backoffMs(attempt: number): number {
  const base = 400 * 2 ** attempt;
  return Math.min(4_000, base) + Math.floor(Math.random() * 250);
}

async function callOnce(
  provider: Provider,
  model: string,
  opts: ChatOptions,
  timeoutMs: number
): Promise<{ ok: true; text: string } | { ok: false; detail: string; transient: boolean; fatal?: boolean }> {
  const messages = opts.system
    ? [{ role: "system", content: opts.system }, ...opts.messages]
    : opts.messages;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.7
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        detail: `HTTP ${res.status} ${body.slice(0, 160)}`.trim(),
        transient: isTransient(res.status),
        fatal: isProviderFatal(res.status)
      };
    }

    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    // A 200 with no content is a failure that looks like a success. Treating it
    // as transient gives the same model one more go before moving on.
    if (!text.trim()) return { ok: false, detail: "empty completion", transient: true };
    return { ok: true, text };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const aborted = e instanceof Error && e.name === "AbortError";
    return { ok: false, detail: aborted ? `timeout after ${timeoutMs}ms` : `network: ${message}`, transient: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Walk providers, then models within a provider, then retries within a model.
 *
 * The ordering matters. Retrying the same model twice before trying a different
 * provider is right for a rate limit or a blip, and wrong for an expired key,
 * which is why a non-transient status skips straight to the next candidate.
 */
export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const deadlineMs = opts.deadlineMs ?? 45_000;
  const attemptsPerModel = Math.max(1, opts.attemptsPerModel ?? 2);
  const deadline = started + deadlineMs;

  const providers = buildProviders();
  const diagnostics: string[] = [];
  const tried: string[] = [];
  let attempts = 0;

  for (const provider of providers) {
    if (provider.disabledReason) {
      diagnostics.push(`${provider.id}: skipped, ${provider.disabledReason}`);
      continue;
    }

    // A tripped provider gets one cheap health probe rather than a full
    // completion attempt. If it is answering again, close the breaker early.
    if (isOpen(provider.id)) {
      const h = await checkProviderHealth(provider);
      if (!h.ok) {
        diagnostics.push(`${provider.id}: skipped, breaker open (${h.detail})`);
        continue;
      }
      breakers.set(provider.id, { failures: 0, openUntil: 0 });
    }

    let providerFatal = false;

    for (const model of provider.models) {
      if (providerFatal) break;
      const label = `${provider.id}/${model}`;

      for (let attempt = 0; attempt < attemptsPerModel; attempt++) {
        const remaining = deadline - Date.now();
        if (remaining <= 1_000) {
          diagnostics.push(`${label}: skipped, out of time`);
          return failed(attempts, tried, diagnostics);
        }

        attempts += 1;
        const result = await callOnce(provider, model, opts, Math.min(timeoutMs, remaining));

        if (result.ok) {
          recordSuccess(provider.id);
          return {
            text: result.text,
            provider: provider.id,
            model,
            attempts,
            ms: Date.now() - started,
            fellBackFrom: tried
          };
        }

        diagnostics.push(`${label} attempt ${attempt + 1}: ${result.detail}`);

        if (result.fatal) {
          providerFatal = true;
          break; // the key is bad, so the provider's other models are too
        }
        if (!result.transient) break; // a dead model id, try the next one
        if (attempt + 1 < attemptsPerModel) {
          const wait = backoffMs(attempt);
          if (Date.now() + wait < deadline) await sleep(wait);
        }
      }

      tried.push(label);
    }

    recordFailure(provider.id);
  }

  return failed(attempts, tried, diagnostics);
}

function failed(attempts: number, tried: string[], diagnostics: string[]): never {
  // Logged once, server-side, with the detail the user must never see.
  console.error(`[ai-pipeline] every provider failed after ${attempts} attempts:\n  ${diagnostics.join("\n  ")}`);
  throw new AiUnavailableError(attempts, tried, diagnostics);
}

/** Convenience wrapper for callers that only want the text. */
export async function chatText(opts: ChatOptions): Promise<string> {
  return (await chat(opts)).text;
}

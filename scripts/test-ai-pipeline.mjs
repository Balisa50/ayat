#!/usr/bin/env node
/**
 * Fallback tests for lib/ai-pipeline.ts.
 *
 *   node --experimental-strip-types scripts/test-ai-pipeline.mjs
 *   npm run test:ai
 *
 * No test framework and no network. Every case replaces global fetch with a
 * fake that fails the way a real provider fails, then asserts which provider
 * ended up answering. The point is not that the code runs, it is that an
 * outage in provider one is invisible to the caller and an outage everywhere
 * produces a sentence a user can read.
 *
 * Runs on Node's type stripping, which is why ai-pipeline.ts has no imports
 * and no path aliases.
 */
import assert from "node:assert/strict";
import { chat, AiUnavailableError, AI_UNAVAILABLE_MESSAGE, resetPipelineState, availableProviders } from "../lib/ai-pipeline.ts";

const realFetch = globalThis.fetch;
let passed = 0;
let failed = 0;

function completion(text) {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

/**
 * @param behaviour map of provider hostname fragment -> handler
 */
function installFetch(behaviour) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const href = typeof url === "string" ? url : url.url;
    calls.push(href);
    for (const [fragment, handler] of Object.entries(behaviour)) {
      if (href.includes(fragment)) return handler(href, init);
    }
    throw new Error(`unexpected host in test: ${href}`);
  };
  return calls;
}

async function test(name, fn) {
  resetPipelineState();
  try {
    await fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// Two providers configured, deterministically, regardless of the developer's
// real environment. Ollama gets a base URL so it can stand in as the last link.
process.env.AI_PROVIDER_ORDER = "nvidia,groq,ollama";
process.env.NVIDIA_API_KEY = "test-nvidia";
process.env.NVIDIA_MODEL = "test-model-a";
process.env.NVIDIA_FALLBACK_MODELS = "";
process.env.GROQ_API_KEY = "test-groq";
process.env.GROQ_MODEL = "test-model-b";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
process.env.OLLAMA_MODEL = "test-model-c";

const FAST = { attemptsPerModel: 2, timeoutMs: 500, deadlineMs: 8_000 };

console.log("\nai-pipeline fallback\n");

await test("uses the first provider when it is healthy", async () => {
  installFetch({ "integrate.api.nvidia.com": () => completion("from nvidia") });
  const res = await chat({ messages: [{ role: "user", content: "hi" }], ...FAST });
  assert.equal(res.provider, "nvidia");
  assert.equal(res.text, "from nvidia");
  assert.equal(res.attempts, 1, "a healthy first provider should cost exactly one call");
});

await test("falls through to the next provider on a 500", async () => {
  installFetch({
    "integrate.api.nvidia.com": () => new Response("upstream exploded", { status: 500 }),
    "api.groq.com": () => completion("from groq")
  });
  const res = await chat({ messages: [{ role: "user", content: "hi" }], ...FAST });
  assert.equal(res.provider, "groq");
  assert.ok(res.fellBackFrom.some((s) => s.startsWith("nvidia/")), "should record what it fell back from");
});

await test("retries a 429 on the same model before moving on", async () => {
  let nvidiaCalls = 0;
  installFetch({
    "integrate.api.nvidia.com": () => {
      nvidiaCalls += 1;
      return nvidiaCalls === 1
        ? new Response("slow down", { status: 429 })
        : completion("nvidia recovered");
    }
  });
  const res = await chat({ messages: [{ role: "user", content: "hi" }], ...FAST });
  assert.equal(res.provider, "nvidia");
  assert.equal(nvidiaCalls, 2, "a rate limit should be retried, not abandoned");
});

await test("does not retry a 401, it moves straight on", async () => {
  let nvidiaCalls = 0;
  installFetch({
    "integrate.api.nvidia.com": () => {
      nvidiaCalls += 1;
      return new Response("bad key", { status: 401 });
    },
    "api.groq.com": () => completion("from groq")
  });
  const res = await chat({ messages: [{ role: "user", content: "hi" }], ...FAST });
  assert.equal(res.provider, "groq");
  assert.equal(nvidiaCalls, 1, "an expired key fails identically on every retry");
});

await test("treats a 200 with an empty completion as a failure", async () => {
  installFetch({
    "integrate.api.nvidia.com": () => completion(""),
    "api.groq.com": () => completion("from groq")
  });
  const res = await chat({ messages: [{ role: "user", content: "hi" }], ...FAST });
  assert.equal(res.provider, "groq");
});

await test("survives a hanging provider by timing it out", async () => {
  installFetch({
    "integrate.api.nvidia.com": (_href, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      }),
    "api.groq.com": () => completion("from groq")
  });
  const res = await chat({ messages: [{ role: "user", content: "hi" }], ...FAST });
  assert.equal(res.provider, "groq");
});

await test("reaches the third provider when the first two are down", async () => {
  installFetch({
    "integrate.api.nvidia.com": () => new Response("down", { status: 503 }),
    "api.groq.com": () => new Response("down", { status: 503 }),
    "127.0.0.1:11434": () => completion("from ollama")
  });
  const res = await chat({ messages: [{ role: "user", content: "hi" }], ...FAST });
  assert.equal(res.provider, "ollama");
});

await test("throws a friendly error when every provider is down", async () => {
  installFetch({
    "integrate.api.nvidia.com": () => new Response("down", { status: 503 }),
    "api.groq.com": () => new Response("down", { status: 503 }),
    "127.0.0.1:11434": () => new Response("down", { status: 503 })
  });
  await assert.rejects(
    () => chat({ messages: [{ role: "user", content: "hi" }], ...FAST }),
    (err) => {
      assert.ok(err instanceof AiUnavailableError);
      assert.equal(err.message, AI_UNAVAILABLE_MESSAGE);
      assert.ok(!/503|api key|nvidia\.com/i.test(err.message), "the user-facing message must not leak internals");
      assert.ok(err.diagnostics.length > 0, "diagnostics are kept for the log");
      return true;
    }
  );
});

await test("skips a provider that has no credentials instead of calling it", async () => {
  delete process.env.NVIDIA_API_KEY;
  const calls = installFetch({ "api.groq.com": () => completion("from groq") });
  const res = await chat({ messages: [{ role: "user", content: "hi" }], ...FAST });
  assert.equal(res.provider, "groq");
  assert.ok(!calls.some((c) => c.includes("nvidia")), "an unconfigured provider must cost zero requests");
  process.env.NVIDIA_API_KEY = "test-nvidia";
});

await test("ollama is not in the chain when no base URL is set", async () => {
  const saved = process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_BASE_URL;
  const ids = availableProviders().map((p) => p.id);
  assert.ok(!ids.includes("ollama"), "a localhost provider must not be attempted from a deployed function");
  process.env.OLLAMA_BASE_URL = saved;
});

await test("the circuit breaker stops re-calling a provider that keeps failing", async () => {
  let nvidiaCalls = 0;
  installFetch({
    "integrate.api.nvidia.com": (href) => {
      // /models is the health probe; count only real completions.
      if (!href.includes("/models")) nvidiaCalls += 1;
      return new Response("down", { status: 503 });
    },
    "api.groq.com": () => completion("from groq")
  });

  await chat({ messages: [{ role: "user", content: "one" }], ...FAST });
  const afterFirst = nvidiaCalls;
  await chat({ messages: [{ role: "user", content: "two" }], ...FAST });

  assert.equal(nvidiaCalls, afterFirst, "once tripped, the dead provider should not be called again");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

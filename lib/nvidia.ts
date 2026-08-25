/**
 * Kept as a thin shim over lib/ai-pipeline.ts.
 *
 * This file used to hold the whole client: one host, one key, a chain of models
 * behind it, and a retry. The model chain was real, and it was not a fallback,
 * because every model in it failed together whenever the key or the host was
 * the problem. That logic now lives in the pipeline, which walks providers
 * first and models second.
 *
 * The export stays so existing call sites keep working. New code should call
 * `chat` or `chatText` from lib/ai-pipeline directly, because those report
 * which provider answered, which is the thing worth logging.
 */
import { chatText, type ChatMessage as PipelineMessage } from "./ai-pipeline";

export type ChatMessage = PipelineMessage;

/** Still exported: read in a couple of places for display. */
export const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "mistralai/mistral-medium-3.5-128b";

interface CallOpts {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

/** @deprecated Use `chat` from lib/ai-pipeline, which reports the provider that answered. */
export async function nvidiaChat(opts: CallOpts): Promise<string> {
  return chatText(opts);
}

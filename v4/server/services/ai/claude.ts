import Anthropic from "@anthropic-ai/sdk";

/**
 * Builds a fresh Anthropic client on every call. We deliberately do NOT cache
 * the instance at module scope: tsx-watch re-runs the entry on .ts changes,
 * but .env edits don't trigger a restart. A stale cached client would carry
 * the old key indefinitely. Constructing a new client is microseconds.
 */
export function getClaude(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  return new Anthropic({ apiKey });
}

export const DEFAULT_MODEL = "claude-sonnet-4-6";

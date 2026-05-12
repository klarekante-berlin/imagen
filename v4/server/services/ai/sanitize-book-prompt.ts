import type { StoryCastMapping } from "../../../shared/types/domain";

export type SanitizeInput = {
  /** The prompt as stored on frame.imagePrompt — may contain manuscript
   * character names (Mika/Lina) and their description block. */
  originalPrompt: string;
  /** Manuscript-name → library-character-name. Pass an empty map if no
   * mapping exists; the function becomes a no-op for that name. */
  castNameMapping: Record<string, string>;
  /** Library-character names that appear on THIS page. Empty array →
   * inject no "Characters in this image:" line. */
  pageCastNames: string[];
};

/** Escape a string for safe insertion into a regex. */
function escapeRegex(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

/**
 * Strip the "Character cast:\nMika: ...\nLina: ..." block that the
 * splitter or the JSON prompts inject. We match from "Character cast:" up
 * to the next blank line OR end of string.
 */
function stripCastDescriptionBlock(input: string): string {
  return input
    .replace(/Character cast:\s*\n(?:[^\n]+\n?)+?(?=\n\s*\n|\.\s|$)/gi, "")
    .replace(/Characters in this image:[^.\n]*\.\s*Match their appearance EXACTLY[^.]*\./gi, "")
    .replace(/Characters in this image:[^.\n]*\.\s*/gi, "");
}

/**
 * Replace manuscriptName tokens with the mapped library character name.
 * Word-boundary matching to avoid replacing partials. Case-insensitive on
 * input, but preserves the casing of the replacement.
 */
function replaceCastNames(
  input: string,
  mapping: Record<string, string>,
): string {
  let out = input;
  for (const [from, to] of Object.entries(mapping)) {
    if (!from || !to || from === to) continue;
    // Avoid double-replacement when manuscript name is substring of replacement.
    const re = new RegExp(`\\b${escapeRegex(from)}\\b`, "gi");
    out = out.replace(re, to);
  }
  return out;
}

/** Trim whitespace bursts left by stripping. Keeps single \n inside text. */
function collapseWhitespace(input: string): string {
  return input
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s+\.$/g, ".")
    .trim();
}

export function sanitizeBookPrompt(input: SanitizeInput): string {
  const { originalPrompt, castNameMapping, pageCastNames } = input;
  if (!originalPrompt.trim()) return originalPrompt;

  let out = originalPrompt;
  out = replaceCastNames(out, castNameMapping);
  out = stripCastDescriptionBlock(out);
  out = collapseWhitespace(out);

  if (pageCastNames.length > 0) {
    const castLine = `Characters in this image: ${pageCastNames.join(", ")}. Match their appearance EXACTLY to the character reference images provided.`;
    if (!out.includes(castLine)) {
      out = `${out}\n\n${castLine}`;
    }
  }

  return out;
}

/**
 * Convenience helper that resolves the (manuscriptName → libraryName) map
 * from a story-level castMapping + a character-id → name lookup.
 */
export function resolveCastNameMapping(
  castMapping: StoryCastMapping | null | undefined,
  characterIdToName: Map<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!castMapping) return out;
  for (const [manuscriptName, characterId] of Object.entries(castMapping)) {
    if (!characterId) continue;
    const libName = characterIdToName.get(characterId);
    if (libName) out[manuscriptName] = libName;
  }
  return out;
}

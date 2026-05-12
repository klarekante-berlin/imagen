import type {
  ContentBlockParam,
  TextBlockParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import type { SectionKind } from "../../../shared/types/enums";
import { DEFAULT_MODEL, getClaude } from "./claude";
import { withRetry } from "./with-retry";

export type CastPoolEntry = {
  /** Library character id. */
  id: string;
  /** Library character name (e.g. "Toni"). */
  name: string;
  /** Optional short description so Claude can match by appearance hints. */
  description?: string;
  /** Manuscript names that map to this character (e.g. ["Mika"]). */
  aliases?: string[];
};

export type PageCastPage = {
  /** Stable id (use the splitter's section index) so we can correlate. */
  id: string;
  sectionKind: SectionKind;
  chapter?: string;
  /** Body text to scan for character mentions. */
  text: string;
};

export type PageCastSuggestion = {
  pageId: string;
  characterIds: string[];
};

const SUGGEST_TOOL: Tool = {
  name: "assign_page_casts",
  description:
    "Decide which library characters appear on each book page based on the page text and the available cast pool.",
  input_schema: {
    type: "object",
    properties: {
      assignments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            page_id: { type: "string" },
            character_ids: {
              type: "array",
              items: { type: "string" },
            },
            reasoning: {
              type: "string",
              description: "1 short clause why these characters were picked.",
            },
          },
          required: ["page_id", "character_ids"],
        },
      },
    },
    required: ["assignments"],
  },
};

const SYSTEM_PROMPT = `You assign characters to pages of a children's book.

You receive a cast pool (library characters with aliases) and a list of book
pages. For each page, return the subset of the cast pool that appears on
that page.

Rules
- Only return character ids from the provided cast pool. Never invent ids.
- Match by alias first (e.g. text says "Mika" → return the id whose aliases
  include "Mika"), then by direct name, then by role inference for cover /
  toc / endpage pages.
- For pages with section_kind in {cover, toc, endpage, chapter_opener}:
  default to the FULL cast pool unless the text explicitly narrows it.
- For body / image_anchor / quiz / experiment / glossary / denkfalle / recap:
  return ONLY characters that are textually present or strongly implied.
- Empty array is allowed if no character is on the page (e.g. a purely
  illustrative scene with no people / animals).
- Always call assign_page_casts. Never return free prose.`;

export type SuggestPageCastInput = {
  pool: CastPoolEntry[];
  pages: PageCastPage[];
  model?: string;
};

export type SuggestPageCastResult = {
  suggestions: PageCastSuggestion[];
  usage: { inputTokens: number; outputTokens: number };
};

const CHUNK = 30;

export async function suggestPageCast(
  input: SuggestPageCastInput,
): Promise<SuggestPageCastResult> {
  const { pool, pages } = input;
  if (pages.length === 0) {
    return { suggestions: [], usage: { inputTokens: 0, outputTokens: 0 } };
  }

  const idsInPool = new Set(pool.map((p) => p.id));
  const aggregate: PageCastSuggestion[] = [];
  let totalIn = 0;
  let totalOut = 0;

  for (let off = 0; off < pages.length; off += CHUNK) {
    const slice = pages.slice(off, off + CHUNK);
    const userPayload = {
      cast_pool: pool.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? "",
        aliases: p.aliases ?? [],
      })),
      pages: slice.map((p) => ({
        page_id: p.id,
        section_kind: p.sectionKind,
        chapter: p.chapter ?? "",
        text: p.text.slice(0, 1200),
      })),
    };
    const system: TextBlockParam[] = [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ];
    const userBlock: ContentBlockParam = {
      type: "text",
      text: JSON.stringify(userPayload, null, 2),
    };
    const client = getClaude();
    const response = await withRetry(
      () =>
        client.messages.create({
          model: input.model ?? DEFAULT_MODEL,
          max_tokens: 4000,
          system,
          tools: [SUGGEST_TOOL],
          tool_choice: { type: "tool", name: "assign_page_casts" },
          messages: [{ role: "user", content: [userBlock] }],
        }),
      { label: "suggestPageCast" },
    );
    totalIn += response.usage.input_tokens;
    totalOut += response.usage.output_tokens;
    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      console.warn(
        `[v4 suggest-page-cast] no tool_use for chunk ${off}..${off + slice.length}`,
      );
      continue;
    }
    const out = toolUse.input as {
      assignments?: Array<{
        page_id?: string;
        character_ids?: string[];
      }>;
    };
    for (const a of out.assignments ?? []) {
      if (!a.page_id) continue;
      const ids = (a.character_ids ?? []).filter((id) => idsInPool.has(id));
      aggregate.push({ pageId: a.page_id, characterIds: ids });
    }
  }

  return {
    suggestions: aggregate,
    usage: { inputTokens: totalIn, outputTokens: totalOut },
  };
}

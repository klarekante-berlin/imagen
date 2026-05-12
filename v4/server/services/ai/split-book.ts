import type {
  ContentBlockParam,
  TextBlockParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import type {
  ImagePromptEntry,
  ParsedManuscript,
  ParsedSection,
} from "../../../shared/types/book";
import type { SectionKind } from "../../../shared/types/enums";
import { SECTION_KINDS } from "../../../shared/types/enums";
import { DEFAULT_MODEL, getClaude } from "./claude";
import { SECTION_VISUAL_GUIDE } from "./prompts/book-sections";

export type BookSplitOptions = {
  /** Prepend a chapter_opener frame for each ## H2. Default false. */
  includeChapterOpeners?: boolean;
  /** Append Cover (start) / ToC (after cover) / Endpage (end). Default true. */
  autoFrontBackMatter?: boolean;
  model?: string;
};

export type BookFrameSpec = {
  /** Section that produced this frame. Null for auto front/back matter. */
  sourceSection: ParsedSection | null;
  sectionKind: SectionKind;
  /** Display page number; null for cover/toc/endpage. */
  pageNumber: number | null;
  chapterTitle: string | null;
  /** What the canvas + atlas will use. */
  imagePrompt: string;
  /** Empty for body frames; mirrors rawText for content sections (used as page caption). */
  caption: string;
  /** Set when the prompt came from a JSON match. */
  jsonEntry: ImagePromptEntry | null;
  /** Used for the UI badge: how this frame was produced. */
  origin: "json" | "claude" | "auto";
};

export type BookSplitResult = {
  frames: BookFrameSpec[];
  stats: {
    jsonMatches: number;
    claudeWrites: number;
    autoFrames: number;
    bySection: Record<SectionKind, number>;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
};

const WRITE_TOOL: Tool = {
  name: "write_section_prompts",
  description:
    "Return one imagePrompt per section_id you receive. Each prompt should be a single self-contained Atlas-ready string describing the illustration for that page; no text overlays unless the section_kind calls for them (e.g. quiz).",
  input_schema: {
    type: "object",
    properties: {
      prompts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            section_id: { type: "string" },
            imagePrompt: { type: "string" },
          },
          required: ["section_id", "imagePrompt"],
        },
      },
    },
    required: ["prompts"],
  },
};

const SYSTEM_PROMPT = `You write illustration prompts for a children's book pipeline.

You will receive a JSON list of book sections that need an Atlas-ready image
prompt. For each section, write ONE imagePrompt describing the single
illustration on that page.

Rules
- Match the section_kind's intent. The user has given each kind its own
  visual language — follow it.
- Use the global character cast verbatim when characters appear in the scene
  (same hairstyle, outfit, age — anchor the look).
- Anchor concrete subjects from the rawText (objects, settings, actions).
- 1 paragraph per prompt, EN or DE — whatever fits the cast description.
- No text overlay unless the section_kind explicitly needs one (quiz, denkfalle).
- Never reference page numbers, layout chrome, or "this page". Describe only
  what the illustration shows.
- Always call write_section_prompts. Never return free prose.`;

function chapterTitleFor(s: ParsedSection, m: ParsedManuscript): string | null {
  for (const ch of m.chapters) {
    if (ch.sections.includes(s)) return ch.title;
  }
  return null;
}

function buildCoverPrompt(m: ParsedManuscript): string {
  const cast = m.extraCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");
  return `Full-bleed children's book cover. Title prominently displayed: "${m.title || "Book"}". Both protagonists centered as the hero subjects, scrapbook framing with kraft-paper tape labels.${cast ? "\n\nCharacter cast:\n" + cast : ""}`;
}

function buildTocPrompt(m: ParsedManuscript): string {
  const titles = m.chapters
    .filter((c) => c.title !== "(Front matter)")
    .map((c, i) => `${i + 1}. ${c.title}`)
    .join("\n");
  return `Decorative table of contents. List each chapter with a small spot illustration of its hero subject next to the title. Hand-lettered numerals.\n\nChapters:\n${titles}`;
}

function buildEndpagePrompt(m: ParsedManuscript): string {
  const cast = m.extraCharacters.map((c) => c.name).join(" & ");
  return `Closing page. ${cast || "The protagonists"} waving goodbye, miniature preview of the next issue's hero subject in the corner, subtle footer repeating "${m.title || "the title"}". Soft farewell mood.`;
}

function buildChapterOpenerPrompt(chapterTitle: string, m: ParsedManuscript): string {
  const cast = m.extraCharacters.map((c) => c.name).join(" and ");
  return `Chapter opener illustration. Large hand-lettered title "${chapterTitle}". ${cast ? cast + " arriving at the chapter's hero subject. " : ""}Scrapbook framing.`;
}

function emptyBySection(): Record<SectionKind, number> {
  return SECTION_KINDS.reduce(
    (acc, k) => ({ ...acc, [k]: 0 }),
    {} as Record<SectionKind, number>,
  );
}

/**
 * Top-level entry point. JSON-matched sections become frames without an LLM
 * call. Unmatched sections are batched into a single Claude write call. Auto
 * Cover/ToC/Endpage (and optional chapter openers) get rule-based prompts.
 */
export async function splitBook(
  manuscript: ParsedManuscript,
  opts: BookSplitOptions = {},
): Promise<BookSplitResult> {
  const flat: ParsedSection[] = manuscript.chapters.flatMap((c) => c.sections);

  // Pass 1 — assign JSON prompts where possible, collect unmatched for batch.
  type Pending = { id: string; section: ParsedSection; chapterTitle: string | null };
  const pending: Pending[] = [];
  const frames: BookFrameSpec[] = [];

  for (let i = 0; i < flat.length; i++) {
    const s = flat[i]!;
    const ct = chapterTitleFor(s, manuscript);
    if (s.matchedPrompts.length > 0) {
      const m = s.matchedPrompts[0]!;
      frames.push({
        sourceSection: s,
        sectionKind: s.kind,
        pageNumber: null,
        chapterTitle: ct,
        imagePrompt: m.prompt_de || m.prompt_en || m.scene_brief_de || "",
        caption: s.rawText,
        jsonEntry: m,
        origin: "json",
      });
    } else {
      pending.push({ id: `s${i}`, section: s, chapterTitle: ct });
      frames.push({
        sourceSection: s,
        sectionKind: s.kind,
        pageNumber: null,
        chapterTitle: ct,
        imagePrompt: "",
        caption: s.rawText,
        jsonEntry: null,
        origin: "claude",
      });
    }
  }

  // Pass 2 — single Claude call for the pending bunch.
  let usage = { inputTokens: 0, outputTokens: 0 };
  if (pending.length > 0) {
    const cast = manuscript.extraCharacters
      .map((c) => `${c.name}: ${c.description}`)
      .join("\n");
    // Chunk pending into batches so the response fits inside max_tokens.
    // 25 sections * ~250 tokens/prompt ≈ 6.2k output tokens — comfortably
    // under the per-call budget while still amortizing the cached prompt.
    const CHUNK = 25;
    const collected = new Map<string, string>();
    for (let off = 0; off < pending.length; off += CHUNK) {
      const slice = pending.slice(off, off + CHUNK);
      const payload = slice.map((p) => ({
        section_id: p.id,
        chapter: p.chapterTitle ?? "",
        section_kind: p.section.kind,
        visual_guidance: SECTION_VISUAL_GUIDE[p.section.kind],
        heading: p.section.headingText,
        text: p.section.rawText.slice(0, 1500),
      }));

      const system: TextBlockParam[] = [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ];
      const userBlock: ContentBlockParam = {
        type: "text",
        text:
          `Book title: ${manuscript.title || "(untitled)"}\n\n` +
          (cast ? `Character cast:\n${cast}\n\n` : "") +
          `Sections needing an imagePrompt:\n${JSON.stringify(payload, null, 2)}`,
      };
      const client = getClaude();
      const response = await client.messages.create({
        model: opts.model ?? DEFAULT_MODEL,
        max_tokens: 16000,
        system,
        tools: [WRITE_TOOL],
        tool_choice: { type: "tool", name: "write_section_prompts" },
        messages: [{ role: "user", content: [userBlock] }],
      });
      const toolUse = response.content.find((c) => c.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        console.warn(
          `[v4 splitBook] Claude returned no tool_use for chunk ${off}..${off + slice.length} — falling back to visual guide.`,
        );
      } else {
        const out = toolUse.input as {
          prompts?: Array<{ section_id?: string; imagePrompt?: string }>;
        };
        for (const p of out.prompts ?? []) {
          if (p.section_id && p.imagePrompt) {
            collected.set(p.section_id, p.imagePrompt);
          }
        }
      }
      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;
    }

    for (let i = 0; i < pending.length; i++) {
      const p = pending[i]!;
      const fIdx = frames.findIndex((f) => f.sourceSection === p.section);
      if (fIdx >= 0) {
        frames[fIdx]!.imagePrompt =
          collected.get(p.id) ?? SECTION_VISUAL_GUIDE[p.section.kind];
      }
    }
  }

  // Pass 3 — optional chapter openers.
  if (opts.includeChapterOpeners) {
    const enriched: BookFrameSpec[] = [];
    let prevChapter: string | null = null;
    for (const f of frames) {
      if (f.chapterTitle && f.chapterTitle !== prevChapter) {
        enriched.push({
          sourceSection: null,
          sectionKind: "chapter_opener",
          pageNumber: null,
          chapterTitle: f.chapterTitle,
          imagePrompt: buildChapterOpenerPrompt(f.chapterTitle, manuscript),
          caption: "",
          jsonEntry: null,
          origin: "auto",
        });
        prevChapter = f.chapterTitle;
      }
      enriched.push(f);
    }
    frames.splice(0, frames.length, ...enriched);
  }

  // Pass 4 — auto front/back matter.
  const auto = opts.autoFrontBackMatter !== false;
  if (auto) {
    frames.unshift({
      sourceSection: null,
      sectionKind: "toc",
      pageNumber: null,
      chapterTitle: null,
      imagePrompt: buildTocPrompt(manuscript),
      caption: "",
      jsonEntry: null,
      origin: "auto",
    });
    frames.unshift({
      sourceSection: null,
      sectionKind: "cover",
      pageNumber: null,
      chapterTitle: null,
      imagePrompt: buildCoverPrompt(manuscript),
      caption: "",
      jsonEntry: null,
      origin: "auto",
    });
    frames.push({
      sourceSection: null,
      sectionKind: "endpage",
      pageNumber: null,
      chapterTitle: null,
      imagePrompt: buildEndpagePrompt(manuscript),
      caption: "",
      jsonEntry: null,
      origin: "auto",
    });
  }

  // Pass 5 — pageNumber assignment. Cover/ToC/Endpage stay null; everything
  // else numbers from 1 in order.
  let n = 1;
  const NUMBERABLE: SectionKind[] = [
    "chapter_opener",
    "recap",
    "image_anchor",
    "body",
    "denkfalle",
    "quiz",
    "experiment",
    "glossary",
    "custom",
  ];
  for (const f of frames) {
    if (NUMBERABLE.includes(f.sectionKind)) {
      f.pageNumber = n++;
    }
  }

  const bySection = emptyBySection();
  let jsonMatches = 0;
  let claudeWrites = 0;
  let autoFrames = 0;
  for (const f of frames) {
    bySection[f.sectionKind]++;
    if (f.origin === "json") jsonMatches++;
    else if (f.origin === "claude") claudeWrites++;
    else autoFrames++;
  }

  return {
    frames,
    stats: { jsonMatches, claudeWrites, autoFrames, bySection },
    usage,
  };
}

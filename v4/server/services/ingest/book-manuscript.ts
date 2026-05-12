import type { SectionKind } from "../../../shared/types/enums";
import { SECTION_KINDS } from "../../../shared/types/enums";
import type {
  ImagePromptEntry,
  ImagePromptsFile,
  ParsedChapter,
  ParsedManuscript,
  ParsedSection,
} from "../../../shared/types/book";

/** Heading-text → SectionKind. First match wins; falls back to "custom". */
const HEADING_PATTERNS: Array<[RegExp, SectionKind]> = [
  [/erinnerst du dich/i, "recap"],
  [/schau mal/i, "image_anchor"],
  [/das hier ist neu/i, "body"],
  [/achtung\s+denkfalle/i, "denkfalle"],
  [/spiel\s+mit/i, "quiz"],
  [/mini[-\s]?experiment/i, "experiment"],
  [/wörterkiste|woerterkiste|w[oö]rterbuch/i, "glossary"],
  [/inhaltsverzeichnis|table of contents|^toc\b/i, "toc"],
  [/^cover$|titelseite/i, "cover"],
  [/abbinder|endpage|abschluss/i, "endpage"],
];

function classifyHeading(text: string): SectionKind {
  for (const [re, kind] of HEADING_PATTERNS) {
    if (re.test(text)) return kind;
  }
  return "custom";
}

function findImageRefs(body: string): number[] {
  const out: number[] = [];
  const re = /\{\{\s*IMG\s*:\s*(\d+)\s*\}\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const n = Number(m[1]);
    if (!Number.isNaN(n)) out.push(n);
  }
  return out;
}

/**
 * Splits markdown by H2/H3 boundaries while preserving line order.
 * Top of file before the first H2 is dropped (book title is the H1 itself,
 * front matter is regenerated downstream).
 */
export function parseBookManuscript(
  markdown: string,
  imagePromptsJson?: ImagePromptsFile,
): ParsedManuscript {
  const lines = markdown.split(/\r?\n/);

  // First H1 = book title.
  let title = "";
  for (const line of lines) {
    const m = /^#\s+(.+)$/.exec(line);
    if (m) {
      title = m[1]!.trim();
      break;
    }
  }

  // Sweep top-down collecting chapters and sections.
  const chapters: ParsedChapter[] = [];
  let currentChapter: ParsedChapter | null = null;
  let currentSection: ParsedSection | null = null;
  let bodyBuffer: string[] = [];

  function flushSection() {
    if (!currentSection || !currentChapter) return;
    currentSection.rawText = bodyBuffer.join("\n").trim();
    currentSection.imageRefs = findImageRefs(currentSection.rawText);
    bodyBuffer = [];
    currentChapter.sections.push(currentSection);
    currentSection = null;
  }

  for (const line of lines) {
    const h2 = /^##\s+(.+)$/.exec(line);
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h2) {
      flushSection();
      if (currentChapter) chapters.push(currentChapter);
      currentChapter = { title: h2[1]!.trim(), sections: [] };
      continue;
    }
    if (h3) {
      flushSection();
      if (!currentChapter) {
        // H3 before any H2 — synthesize a wrapper chapter so we don't lose it.
        currentChapter = { title: "(Front matter)", sections: [] };
      }
      const headingText = h3[1]!.trim();
      currentSection = {
        kind: classifyHeading(headingText),
        headingText,
        rawText: "",
        imageRefs: [],
        matchedPrompts: [],
      };
      continue;
    }
    if (currentSection) bodyBuffer.push(line);
  }
  flushSection();
  if (currentChapter) chapters.push(currentChapter);

  // JSON match pass. Build id → entry index for O(1) lookup.
  const promptsById = new Map<number, ImagePromptEntry>();
  if (imagePromptsJson?.prompts) {
    for (const p of imagePromptsJson.prompts) {
      if (typeof p.id === "number") promptsById.set(p.id, p);
    }
  }

  let jsonMatches = 0;
  let imageRefs = 0;
  for (const ch of chapters) {
    for (const s of ch.sections) {
      imageRefs += s.imageRefs.length;
      const matched: ImagePromptEntry[] = [];
      for (const n of s.imageRefs) {
        const entry = promptsById.get(n);
        if (entry) {
          matched.push(entry);
          jsonMatches++;
        }
      }
      s.matchedPrompts = matched;
    }
  }

  const bySection: Record<SectionKind, number> = SECTION_KINDS.reduce(
    (acc, k) => ({ ...acc, [k]: 0 }),
    {} as Record<SectionKind, number>,
  );
  let sectionCount = 0;
  for (const ch of chapters) {
    for (const s of ch.sections) {
      bySection[s.kind]++;
      sectionCount++;
    }
  }

  return {
    title,
    chapters,
    extraCharacters: imagePromptsJson?.characters ?? [],
    stats: {
      chapters: chapters.length,
      sections: sectionCount,
      imageRefs,
      jsonMatches,
      bySection,
    },
  };
}

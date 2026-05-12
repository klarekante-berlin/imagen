import type { SectionKind } from "./enums";

/** Raw entry shape in an image_prompts.json companion file. */
export type ImagePromptEntry = {
  id: number;
  chapter?: string;
  section_anchor?: string;
  scene_brief_de?: string;
  prompt_en?: string;
  prompt_de?: string;
  negative_prompt?: string;
  aspect_ratio?: string;
  style_refs?: string[];
  didactic_role?: string;
};

export type ImagePromptsFile = {
  age_group?: string;
  characters?: Array<{ name: string; description: string }>;
  prompts: ImagePromptEntry[];
};

/** One ### sub-section of a chapter after parsing. */
export type ParsedSection = {
  kind: SectionKind;
  /** Raw H3 heading text exactly as in the markdown. */
  headingText: string;
  /** Body content under the heading (markdown), with {{IMG:N}} placeholders intact. */
  rawText: string;
  /** Image refs found in rawText, e.g. [1, 2]. */
  imageRefs: number[];
  /** JSON entries whose id matches one of imageRefs (in order). */
  matchedPrompts: ImagePromptEntry[];
};

export type ParsedChapter = {
  title: string;
  sections: ParsedSection[];
};

export type ParsedManuscript = {
  /** First H1 of the markdown, or empty. */
  title: string;
  chapters: ParsedChapter[];
  /** Global characters from the companion JSON, if any. */
  extraCharacters: Array<{ name: string; description: string }>;
  /** Summary counts for the upload preview. */
  stats: {
    chapters: number;
    sections: number;
    imageRefs: number;
    jsonMatches: number;
    bySection: Record<SectionKind, number>;
  };
};

export const TEMPLATE_KINDS = [
  "carousel",
  "book_artwork",
  "learning",
  "illustration",
  "custom",
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const TRANSPARENCY_MODES = ["opaque", "alpha", "full_bleed"] as const;
export type TransparencyMode = (typeof TRANSPARENCY_MODES)[number];

export const FRAME_TYPES = ["slide", "page", "illustration"] as const;
export type FrameType = (typeof FRAME_TYPES)[number];

export const FRAME_STATUSES = [
  "draft",
  "queued",
  "generating",
  "ready",
  "error",
] as const;
export type FrameStatus = (typeof FRAME_STATUSES)[number];

export const STORY_STATUSES = [
  "draft",
  "planning",
  "ready",
  "generating",
  "complete",
  "error",
] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

export const ASSET_KINDS = [
  "character_sheet",
  "environment",
  "style_ref",
  "prop",
  "generated_frame",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const CHARACTER_ORIGINS = ["user", "anticipated", "imported"] as const;
export type CharacterOrigin = (typeof CHARACTER_ORIGINS)[number];

export const PROMPT_KEYS = ["plan", "write", "style", "anticipate"] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

export const JOB_KINDS = [
  "embed_asset",
  "embed_rendition",
  "generate_frame",
  "anticipate_character",
  "quality_check",
  "cleanup_renditions",
  "auto_tag",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = [
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

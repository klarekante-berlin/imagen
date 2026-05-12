import type {
  AssetKind,
  AssetVariantKind,
  AttachmentRef,
  AttachmentScope,
  CharacterOrigin,
  FrameStatus,
  FrameType,
  JobKind,
  JobStatus,
  PromptKey,
  SectionKind,
  StoryKind,
  StoryStatus,
  TemplateKind,
  TransparencyMode,
} from "./enums";

export type TagAxes = {
  mood?: string;
  location?: string;
  timeOfDay?: string;
  cameraAngle?: string;
  contentType?: string;
};

export type TemplateDefaults = {
  imageFormat: string;
  frameCountMin: number;
  frameCountMax: number;
  transparency: TransparencyMode;
  frameType: FrameType;
  defaultPrompts: Record<PromptKey, string>;
};

export type TemplateUiHints = {
  tagline?: string;
  exampleStructure?: string;
};

export type ProjectSettings = {
  imageFormat?: string;
  frameCountMin?: number;
  frameCountMax?: number;
  transparency?: TransparencyMode;
};

export type ProjectActivePromptIds = Partial<Record<PromptKey, string>>;

export type SceneCharacterRef = {
  characterId?: string;
  rawName: string;
};

export type RenditionParams = {
  prompt: string;
  refs: string[];
  transparency: TransparencyMode;
  aspect: string;
  seed?: number;
};

export type QcReport = {
  pass: boolean;
  issues: string[];
  scores: Record<string, number>;
};

export type AssetMetadata = {
  tagAxes?: TagAxes;
  pose?: string;
  outfit?: string;
  setting?: string;
  dominantColors?: string[];
  visionConfidence?: number;
  reviewStatus?: "pending" | "approved" | "needs_review";
  /** Pixel dimensions after upload-time normalization. */
  width?: number;
  height?: number;
  /** Bytes on disk after normalization. */
  bytes?: number;
  /** Name Claude read off the sheet's caption — pending UI suggestion when
   * no existing character matched. Cleared once user accepts or dismisses. */
  inferredCharacterName?: string;
  inferredCharacterDismissed?: boolean;
};

export type WorldStyleTokens = {
  artStyle?: string;
  colorPalette?: string[];
  typography?: string;
  notes?: string;
};

export type AssetVariantBbox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AssetVariantMetadata = {
  tagAxes?: TagAxes;
  tags?: string[];
  visualDescription?: string;
  dominantColors?: string[];
};

/** Book-page provenance preserved when a frame's imagePrompt came from a
 * hand-tuned image_prompts.json companion. Currently advisory — generation
 * still uses imagePrompt + template defaults. */
export type FrameMetadata = {
  negativePrompt?: string;
  aspectRatio?: string;
  styleRefs?: string[];
  didacticRole?: string;
};

/** Maps a manuscript-side character name (from image_prompts.json.characters
 * or from the heft text) to a library character id. `null` means user
 * intentionally left it unmapped — the name will be stripped from prompts. */
export type StoryCastMapping = Record<string, string | null>;

export type {
  AssetKind,
  AssetVariantKind,
  AttachmentRef,
  AttachmentScope,
  CharacterOrigin,
  FrameStatus,
  FrameType,
  JobKind,
  JobStatus,
  PromptKey,
  SectionKind,
  StoryKind,
  StoryStatus,
  TemplateKind,
  TransparencyMode,
};

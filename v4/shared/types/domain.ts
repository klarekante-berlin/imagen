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
  StoryKind,
  StoryStatus,
  TemplateKind,
  TransparencyMode,
};

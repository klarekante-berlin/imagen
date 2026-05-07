/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";

// ─── Story / Slide Types ──────────────────────────────────────────────────────

/** Legacy v1 shape — single environment, fixed 10 slides. Kept for backcompat reads. */
export interface ConsistencyContextV1 {
  artStyle: string;
  colorPalette: string;
  environment: string;
  characters: Array<{
    assetId: number;
    name: string;
    outfit: string;
    visualDescription: string;
    referenceImageUrl?: string;
  }>;
  globalStylePrompt: string;
  styleReferenceUrls?: string[];
}

/** Multi-scene story v2. */
export interface Scene {
  id: string;                     // "scene-1" — stable across regenerates
  slideRange: [number, number];   // 1-indexed inclusive
  environment: string;            // location description
  environmentLockNotes: string;   // "same window, same coffee mug"
  transitionToNext?: string;      // bridge text on the last slide of this scene
  environmentRefAssetId?: number; // Phase-3: world-built env reference
}

export interface ConsistencyCharacterRef {
  characterId: number;            // FK to characters.id (0 = pre-v2 legacy)
  assetId: number;                // primary sheet
  name: string;
  outfit: string;
  visualDescription: string;
  referenceImageUrl?: string;
  worldBuilt?: boolean;
}

export interface ConsistencyContextV2 {
  version: 2;
  artStyle: string;
  colorPalette: string;
  scenes: Scene[];
  characters: ConsistencyCharacterRef[];
  globalStylePrompt: string;
  styleReferenceUrls?: string[];
  worldBuiltAssetIds: number[];
  slideCount: number;             // 3..10
}

/** Default export is v2. v1 kept under an explicit alias. */
export type ConsistencyContext = ConsistencyContextV2;

export interface SlideContent {
  slideNumber: number;
  textContent: string;
  caption: string;
  charactersInSlide: string[];
  imagePrompt: string;
  sceneId?: string;
}

export interface StoryContent {
  title: string;
  consistencyContext: ConsistencyContext;
  slides: SlideContent[];
  usedAssetIds: number[];
}

// ─── Story Planner Types ──────────────────────────────────────────────────────

export interface DetectedEntity {
  name: string;
  type: "character" | "object" | "place";
  matchedCharacterId?: number;
  matchedAssetIds: number[];
  needsWorldBuilding: boolean;
  draftVisualDescription?: string;
  character?: import("../drizzle/schema").Character | null;
}

export interface StoryPlan {
  title: string;
  suggestedSlideCount: number;     // 3..10
  reasoning: string;
  scenes: Scene[];                 // covers [1..suggestedSlideCount] without gaps
  detectedEntities: DetectedEntity[];
}

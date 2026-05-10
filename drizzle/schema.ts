/**
 * Imagen V3 – Drizzle Schema (Turso / libSQL)
 *
 * Migrated from drizzle-orm/mysql-core → drizzle-orm/sqlite-core.
 * Changes:
 *   - mysqlTable → sqliteTable
 *   - mysqlEnum  → text().$type<T>() with TS const arrays (no DB enum)
 *   - timestamp  → text (ISO-8601 UTC strings via strftime)
 *   - int().autoincrement() → integer({ mode:'number' }).primaryKey({ autoIncrement:true })
 *   - boolean    → integer({ mode:'boolean' })
 *   - json       → text({ mode:'json' })
 *   - varchar    → text (SQLite has no varchar length enforcement)
 *   - NEW: projects table – format-agnostic, replaces hardcoded IMAGE_FORMATS
 *   - NEW: assets.embedding blob for Voyage AI multimodal vectors
 *   - NEW: slides.jobId + retryCount for Inngest queue
 */
import {
  sqliteTable,
  text,
  integer,
  blob,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { AssetVariant, ConsistencyContext } from "../shared/types";

// ─── Shared helpers ────────────────────────────────────────────────────────────
const now = sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`;

// ─── Enum-like constants (TS only – no DB enum, easier to extend) ──────────────
export const ASSET_CATEGORIES = [
  "familie",
  "historisch",
  "sport",
  "musik",
  "politiker",
  "tech-ceo",
  "tiere",
  "umgebungen",
  "fahrzeuge",
  "items",
  "stil-referenz",
  "sonstiges",
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const CHARACTER_KINDS = ["family", "public_figure", "fictional", "world-built"] as const;
export type CharacterKind = (typeof CHARACTER_KINDS)[number];

export const REVIEW_STATUSES = ["pending", "approved", "needs_review"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const STORY_STATUSES = [
  "draft",
  "generating_text",
  "generating_images",
  "complete",
  "error",
] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

export const SLIDE_STATUSES = ["pending", "generating", "complete", "error"] as const;
export type SlideStatus = (typeof SLIDE_STATUSES)[number];

export const AI_MODELS = ["claude-sonnet-4-6", "claude-opus-4-5"] as const;
export type AiModel = (typeof AI_MODELS)[number];

export const IMAGE_PROVIDERS = ["gpt-image-2", "freepik"] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];

export const IMAGE_FORMATS = ["1:1", "4:5", "16:9", "9:16"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

// ─── Projects ─────────────────────────────────────────────────────────────────
/**
 * Defines a creative format (Instagram Carousel, Book, YouTube Thumbnail…).
 * All prompts and format rules live here – nothing hardcoded in server code.
 * The default project (id=1) is the klarekante.berlin Instagram Carousel.
 */
export const projects = sqliteTable(
  "projects",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    /** Free-form aspect ratio: "1:1", "4:5", "16:9", "2:3", … */
    imageFormat: text("imageFormat").notNull().default("1:1"),
    /** System prompt for the PLAN phase (tone, structure, frame count rules). */
    planSystemPrompt: text("planSystemPrompt").notNull(),
    /** System prompt for the WRITE phase (text style, imagePrompt rules). */
    writeSystemPrompt: text("writeSystemPrompt").notNull(),
    /** Prepended to every imagePrompt before Atlas Cloud. Defines render style. */
    globalStylePrompt: text("globalStylePrompt").notNull(),
    /** JSON array of AssetCategory – limits which assets are shown in planner. */
    allowedAssetCategories: text("allowedAssetCategories", { mode: "json" })
      .$type<AssetCategory[]>(),
    minFrames: integer("minFrames").notNull().default(1),
    maxFrames: integer("maxFrames").notNull().default(10),
    createdAt: text("createdAt").notNull().default(now),
    updatedAt: text("updatedAt").notNull().default(now),
  },
  (t) => ({
    nameIdx: uniqueIndex("projects_name_idx").on(t.name),
  })
);
export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

// ─── Characters ───────────────────────────────────────────────────────────────
export const characters = sqliteTable(
  "characters",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    aliases: text("aliases", { mode: "json" }).$type<string[]>(),
    kind: text("kind").$type<CharacterKind>().notNull().default("family"),
    defaultDescription: text("defaultDescription"),
    defaultStyleNotes: text("defaultStyleNotes"),
    /** FK → assets.id – primary character sheet used as reference image. */
    primaryAssetId: integer("primaryAssetId"),
    /** Set when character was created via world-building during a story. */
    createdByStoryId: integer("createdByStoryId"),
    createdAt: text("createdAt").notNull().default(now),
    updatedAt: text("updatedAt").notNull().default(now),
  },
  (t) => ({
    nameIdx: uniqueIndex("characters_name_idx").on(t.name),
    kindIdx: index("characters_kind_idx").on(t.kind),
  })
);
export type Character = typeof characters.$inferSelect;
export type InsertCharacter = typeof characters.$inferInsert;

// ─── Assets ───────────────────────────────────────────────────────────────────
export const assets = sqliteTable(
  "assets",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    category: text("category").$type<AssetCategory>().notNull().default("sonstiges"),
    description: text("description"),
    /** Path relative to storage-data/ (e.g. "assets/papa-01.png") */
    imageKey: text("imageKey").notNull(),
    /** Served URL (e.g. "/storage/assets/papa-01.png") */
    imageUrl: text("imageUrl").notNull(),
    /** Claude-generated visual description for prompt context. */
    visualDescription: text("visualDescription"),
    tags: text("tags", { mode: "json" }).$type<string[]>(),
    /** FK → characters.id (nullable: not every asset is a person) */
    characterId: integer("characterId"),
    isCharacterSheet: integer("isCharacterSheet", { mode: "boolean" }).notNull().default(false),
    pose: text("pose"),
    outfit: text("outfit"),
    setting: text("setting"),
    mood: text("mood"),
    dominantColors: text("dominantColors", { mode: "json" }).$type<string[]>(),
    /**
     * Vision-extracted variant panels (outfits, age stages, env moments…).
     * Populated when image is detected as a variant sheet.
     */
    variants: text("variants", { mode: "json" }).$type<AssetVariant[]>(),
    /** sha256 – dedup + idempotency */
    contentHash: text("contentHash"),
    /** Original ingest path (e.g. klarekante-style/papa/foo.png) */
    sourcePath: text("sourcePath"),
    autoCategorized: integer("autoCategorized", { mode: "boolean" }).notNull().default(false),
    visionConfidence: integer("visionConfidence"),
    reviewStatus: text("reviewStatus").$type<ReviewStatus>().notNull().default("approved"),
    /**
     * Voyage AI multimodal-3.5 embedding (1024 dims, raw Float32 buffer).
     * Populated on upload via embedAsset(). Used by findAssetsByEmbedding().
     * Vector index created via raw SQL: migrations/0001_add_vector_index.sql
     */
    embedding: blob("embedding"),
    createdAt: text("createdAt").notNull().default(now),
    updatedAt: text("updatedAt").notNull().default(now),
  },
  (t) => ({
    characterIdx: index("assets_character_idx").on(t.characterId),
    categoryIdx: index("assets_category_idx").on(t.category),
    contentHashIdx: uniqueIndex("assets_content_hash_idx").on(t.contentHash),
    reviewStatusIdx: index("assets_review_status_idx").on(t.reviewStatus),
    sourcePathIdx: index("assets_source_path_idx").on(t.sourcePath),
  })
);
export type Asset = typeof assets.$inferSelect;
export type InsertAsset = typeof assets.$inferInsert;

// ─── Stories ──────────────────────────────────────────────────────────────────
export const stories = sqliteTable(
  "stories",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    /** FK → projects.id – determines format, prompts, style. */
    projectId: integer("projectId").notNull().default(1),
    title: text("title").notNull(),
    theme: text("theme").notNull(),
    status: text("status").$type<StoryStatus>().notNull().default("draft"),
    model: text("model").$type<AiModel>().notNull().default("claude-sonnet-4-6"),
    imageProvider: text("imageProvider").$type<ImageProvider>().notNull().default("gpt-image-2"),
    /** Inherits from project.imageFormat but can be overridden per story. */
    imageFormat: text("imageFormat").notNull().default("1:1"),
    /**
     * Consistency context (JSON). Shape defined in shared/types.ts.
     * Read through normalizeConsistencyContext() for v1→v2 upgrades.
     */
    consistencyContext: text("consistencyContext", { mode: "json" })
      .$type<ConsistencyContext>(),
    usedAssetIds: text("usedAssetIds", { mode: "json" }).$type<number[]>(),
    createdAt: text("createdAt").notNull().default(now),
    updatedAt: text("updatedAt").notNull().default(now),
  },
  (t) => ({
    statusIdx: index("stories_status_idx").on(t.status),
    projectIdx: index("stories_project_idx").on(t.projectId),
    createdAtIdx: index("stories_created_at_idx").on(t.createdAt),
  })
);
export type Story = typeof stories.$inferSelect;
export type InsertStory = typeof stories.$inferInsert;

// ─── Slides ───────────────────────────────────────────────────────────────────
export const slides = sqliteTable(
  "slides",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    storyId: integer("storyId").notNull(),
    slideNumber: integer("slideNumber").notNull(),
    textContent: text("textContent"),
    caption: text("caption"),
    charactersInSlide: text("charactersInSlide", { mode: "json" }).$type<string[]>(),
    /** FK → consistencyContext.scenes[].id (e.g. "scene-1") */
    sceneId: text("sceneId"),
    imagePrompt: text("imagePrompt"),
    imageKey: text("imageKey"),
    imageUrl: text("imageUrl"),
    status: text("status").$type<SlideStatus>().notNull().default("pending"),
    /**
     * True when prompt context has drifted from the rendered image.
     * Drives the "Regenerate to apply" hint in the UI.
     */
    needsRegen: integer("needsRegen", { mode: "boolean" }).notNull().default(false),
    /**
     * Per-slide selected variant per ref slot.
     *   "character:<name>" → variant name on character's primary asset
     *   "scene:<sceneId>"  → variant name on scene's environment asset
     */
    selectedVariants: text("selectedVariants", { mode: "json" })
      .$type<Record<string, string>>(),
    /** Inngest job ID – set when generation job is dispatched. */
    jobId: text("jobId"),
    /** Incremented on each retry attempt. Max 3 before permanent error. */
    retryCount: integer("retryCount").notNull().default(0),
    errorMessage: text("errorMessage"),
    createdAt: text("createdAt").notNull().default(now),
    updatedAt: text("updatedAt").notNull().default(now),
  },
  (t) => ({
    storyIdx: index("slides_story_idx").on(t.storyId),
    sceneIdIdx: index("slides_scene_id_idx").on(t.sceneId),
    jobIdx: index("slides_job_idx").on(t.jobId),
  })
);
export type Slide = typeof slides.$inferSelect;
export type InsertSlide = typeof slides.$inferInsert;

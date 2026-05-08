import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  json,
} from "drizzle-orm/mysql-core";

// ─── Asset / Character Library ───────────────────────────────────────────────

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

export const CHARACTER_KINDS = [
  "family",
  "public_figure",
  "fictional",
  "world-built",
] as const;
export type CharacterKind = (typeof CHARACTER_KINDS)[number];

export const characters = mysqlTable(
  "characters",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    aliases: json("aliases").$type<string[]>(),
    kind: mysqlEnum("kind", CHARACTER_KINDS).notNull().default("family"),
    defaultDescription: text("defaultDescription"),
    defaultStyleNotes: text("defaultStyleNotes"),
    primaryAssetId: int("primaryAssetId"),
    createdByStoryId: int("createdByStoryId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => ({
    nameIdx: uniqueIndex("characters_name_idx").on(t.name),
    kindIdx: index("characters_kind_idx").on(t.kind),
  })
);

export type Character = typeof characters.$inferSelect;
export type InsertCharacter = typeof characters.$inferInsert;

export const REVIEW_STATUSES = ["pending", "approved", "needs_review"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const assets = mysqlTable(
  "assets",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    category: mysqlEnum("category", ASSET_CATEGORIES).notNull().default("sonstiges"),
    description: text("description"),
    /** S3 storage key for the image */
    imageKey: varchar("imageKey", { length: 512 }).notNull(),
    /** Public URL served via /manus-storage/ */
    imageUrl: varchar("imageUrl", { length: 1024 }).notNull(),
    /** Detailed visual description used as reference in image prompts */
    visualDescription: text("visualDescription"),
    /** Tags for search/filter */
    tags: json("tags").$type<string[]>(),
    /** FK -> characters.id (nullable: not every asset is a person) */
    characterId: int("characterId"),
    /** Clean reference shot vs scene/variation */
    isCharacterSheet: boolean("isCharacterSheet").notNull().default(false),
    /** Vision-extracted structured metadata */
    pose: varchar("pose", { length: 128 }),
    outfit: text("outfit"),
    setting: varchar("setting", { length: 255 }),
    mood: varchar("mood", { length: 64 }),
    dominantColors: json("dominantColors").$type<string[]>(),
    /** sha256 — dedup + idempotency */
    contentHash: varchar("contentHash", { length: 64 }),
    /** Original ingest path (e.g. klarekante-style/papa/foo.png) */
    sourcePath: varchar("sourcePath", { length: 512 }),
    /** Audit: was this auto-categorized via vision? */
    autoCategorized: boolean("autoCategorized").notNull().default(false),
    /** Vision confidence 0-100 */
    visionConfidence: int("visionConfidence"),
    /** Drives Library review-UI */
    reviewStatus: mysqlEnum("reviewStatus", REVIEW_STATUSES).notNull().default("approved"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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

export const STORY_STATUSES = ["draft", "generating_text", "generating_images", "complete", "error"] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

export const IMAGE_FORMATS = ["1:1", "4:5"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export const AI_MODELS = ["claude-sonnet-4-6", "claude-opus-4-5"] as const;
export type AiModel = (typeof AI_MODELS)[number];

export const IMAGE_PROVIDERS = ["gpt-image-2", "freepik"] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];

export const stories = mysqlTable(
  "stories",
  {
    id: int("id").autoincrement().primaryKey(),
    title: varchar("title", { length: 512 }).notNull(),
    theme: text("theme").notNull(),
    status: mysqlEnum("status", STORY_STATUSES).default("draft").notNull(),
    model: mysqlEnum("model", AI_MODELS).default("claude-sonnet-4-6").notNull(),
    imageProvider: mysqlEnum("imageProvider", IMAGE_PROVIDERS).default("gpt-image-2").notNull(),
    imageFormat: mysqlEnum("imageFormat", IMAGE_FORMATS).default("1:1").notNull(),
    /**
     * Consistency context (JSON). Shape evolves over time — read through
     * `normalizeConsistencyContext()` so legacy v1 payloads upgrade to v2.
     */
    consistencyContext: json("consistencyContext").$type<unknown>(),
    /** IDs of assets used in this story */
    usedAssetIds: json("usedAssetIds").$type<number[]>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => ({
    statusIdx: index("stories_status_idx").on(t.status),
    createdAtIdx: index("stories_created_at_idx").on(t.createdAt),
  })
);

export type Story = typeof stories.$inferSelect;
export type InsertStory = typeof stories.$inferInsert;

// ─── Slides ───────────────────────────────────────────────────────────────────

export const slides = mysqlTable(
  "slides",
  {
    id: int("id").autoincrement().primaryKey(),
    storyId: int("storyId").notNull(),
    slideNumber: int("slideNumber").notNull(), // 1–10
    /** Scene/dialogue text shown on the slide */
    textContent: text("textContent"),
    /** Caption/dialogue for the image */
    caption: text("caption"),
    /** Characters appearing in this specific slide */
    charactersInSlide: json("charactersInSlide").$type<string[]>(),
    /**
     * Scene this slide belongs to. Free-string FK to
     * `consistencyContext.scenes[].id` (e.g. "scene-1"). Nullable for legacy
     * rows pre-migration; backfill via `scripts/backfill-slide-scene-id.ts`.
     */
    sceneId: varchar("sceneId", { length: 64 }),
    /** Full image generation prompt */
    imagePrompt: text("imagePrompt"),
    /** S3 key for generated image */
    imageKey: varchar("imageKey", { length: 512 }),
    /** Public URL for generated image */
    imageUrl: varchar("imageUrl", { length: 1024 }),
    status: mysqlEnum("status", ["pending", "generating", "complete", "error"]).default("pending").notNull(),
    /**
     * Set true when the slide's prompt context has drifted from the rendered
     * image (scene reassigned, scene env edited, prompt edited). Reset by
     * `regenerateSlide`. Drives the "Regenerate to apply" hint in the UI.
     */
    needsRegen: boolean("needsRegen").notNull().default(false),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => ({
    storyIdx: index("slides_story_idx").on(t.storyId),
    sceneIdIdx: index("slides_scene_id_idx").on(t.sceneId),
  })
);

export type Slide = typeof slides.$inferSelect;
export type InsertSlide = typeof slides.$inferInsert;

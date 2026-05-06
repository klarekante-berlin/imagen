import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  json,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

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
  "sonstiges",
] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const assets = mysqlTable("assets", {
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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

export const stories = mysqlTable("stories", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 512 }).notNull(),
  theme: text("theme").notNull(),
  status: mysqlEnum("status", STORY_STATUSES).default("draft").notNull(),
  model: mysqlEnum("model", AI_MODELS).default("claude-sonnet-4-6").notNull(),
  imageProvider: mysqlEnum("imageProvider", IMAGE_PROVIDERS).default("gpt-image-2").notNull(),
  imageFormat: mysqlEnum("imageFormat", IMAGE_FORMATS).default("1:1").notNull(),
  /**
   * Consistency context: locked outfits, environment, style for the whole story.
   * Stored as JSON so the image prompts stay coherent across all 10 slides.
   */
  consistencyContext: json("consistencyContext").$type<{
    artStyle: string;
    colorPalette: string;
    environment: string;
    characters: Array<{
      assetId: number;
      name: string;
      outfit: string;
      visualDescription: string;
    }>;
    globalStylePrompt: string;
  }>(),
  /** IDs of assets used in this story */
  usedAssetIds: json("usedAssetIds").$type<number[]>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Story = typeof stories.$inferSelect;
export type InsertStory = typeof stories.$inferInsert;

// ─── Slides ───────────────────────────────────────────────────────────────────

export const slides = mysqlTable("slides", {
  id: int("id").autoincrement().primaryKey(),
  storyId: int("storyId").notNull(),
  slideNumber: int("slideNumber").notNull(), // 1–10
  /** Scene/dialogue text shown on the slide */
  textContent: text("textContent"),
  /** Caption/dialogue for the image */
  caption: text("caption"),
  /** Characters appearing in this specific slide */
  charactersInSlide: json("charactersInSlide").$type<string[]>(),
  /** Full image generation prompt */
  imagePrompt: text("imagePrompt"),
  /** S3 key for generated image */
  imageKey: varchar("imageKey", { length: 512 }),
  /** Public URL for generated image */
  imageUrl: varchar("imageUrl", { length: 1024 }),
  status: mysqlEnum("status", ["pending", "generating", "complete", "error"]).default("pending").notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Slide = typeof slides.$inferSelect;
export type InsertSlide = typeof slides.$inferInsert;

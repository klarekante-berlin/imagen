import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";

import type {
  AssetKind,
  AssetMetadata,
  CharacterOrigin,
  FrameStatus,
  FrameType,
  JobKind,
  JobStatus,
  ProjectActivePromptIds,
  ProjectSettings,
  PromptKey,
  QcReport,
  RenditionParams,
  SceneCharacterRef,
  StoryStatus,
  TagAxes,
  TemplateDefaults,
  TemplateKind,
  TemplateUiHints,
  TransparencyMode,
} from "../shared/types/domain";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`;
const id = () => text("id").primaryKey().$defaultFn(() => nanoid(14));

export const templates = sqliteTable(
  "templates",
  {
    id: id(),
    name: text("name").notNull(),
    kind: text("kind").$type<TemplateKind>().notNull(),
    defaultsJson: text("defaults_json", { mode: "json" })
      .$type<TemplateDefaults>()
      .notNull(),
    uiHintsJson: text("ui_hints_json", { mode: "json" }).$type<TemplateUiHints>(),
    isBuiltIn: integer("is_built_in", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => ({
    nameIdx: uniqueIndex("templates_name_idx").on(t.name),
  }),
);

export const projects = sqliteTable(
  "projects",
  {
    id: id(),
    name: text("name").notNull(),
    description: text("description"),
    templateId: text("template_id").notNull(),
    settingsJson: text("settings_json", { mode: "json" }).$type<ProjectSettings>(),
    activePromptIdsJson: text("active_prompt_ids_json", { mode: "json" })
      .$type<ProjectActivePromptIds>(),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => ({
    nameIdx: uniqueIndex("projects_name_idx").on(t.name),
    templateIdx: index("projects_template_idx").on(t.templateId),
  }),
);

export const promptRevisions = sqliteTable(
  "prompt_revisions",
  {
    id: id(),
    projectId: text("project_id").notNull(),
    key: text("key").$type<PromptKey>().notNull(),
    text: text("text").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => ({
    projectKeyIdx: index("prompt_rev_project_key_idx").on(t.projectId, t.key),
  }),
);

export const characters = sqliteTable(
  "characters",
  {
    id: id(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    aliasesJson: text("aliases_json", { mode: "json" }).$type<string[]>(),
    description: text("description"),
    persona: text("persona"),
    traitsJson: text("traits_json", { mode: "json" }).$type<Record<string, string>>(),
    primaryAssetId: text("primary_asset_id"),
    origin: text("origin").$type<CharacterOrigin>().notNull().default("user"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => ({
    projectIdx: index("characters_project_idx").on(t.projectId),
    nameIdx: index("characters_name_idx").on(t.projectId, t.name),
  }),
);

export const assets = sqliteTable(
  "assets",
  {
    id: id(),
    projectId: text("project_id"),
    characterId: text("character_id"),
    kind: text("kind").$type<AssetKind>().notNull(),
    name: text("name").notNull(),
    imageKey: text("image_key").notNull(),
    imageUrl: text("image_url").notNull(),
    contentHash: text("content_hash"),
    visualDescription: text("visual_description"),
    tagAxesJson: text("tag_axes_json", { mode: "json" }).$type<TagAxes>(),
    tagsJson: text("tags_json", { mode: "json" }).$type<string[]>(),
    metadataJson: text("metadata_json", { mode: "json" }).$type<AssetMetadata>(),
    embedding: blob("embedding"),
    sourceRenditionId: text("source_rendition_id"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => ({
    projectIdx: index("assets_project_idx").on(t.projectId),
    characterIdx: index("assets_character_idx").on(t.characterId),
    kindIdx: index("assets_kind_idx").on(t.kind),
    contentHashIdx: uniqueIndex("assets_content_hash_idx").on(t.contentHash),
  }),
);

export const stories = sqliteTable(
  "stories",
  {
    id: id(),
    projectId: text("project_id"),
    title: text("title").notNull(),
    sourceText: text("source_text").notNull().default(""),
    status: text("status").$type<StoryStatus>().notNull().default("draft"),
    settingsJson: text("settings_json", { mode: "json" }).$type<ProjectSettings>(),
    worldSnapshotJson: text("world_snapshot_json", { mode: "json" }),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => ({
    projectIdx: index("stories_project_idx").on(t.projectId),
    statusIdx: index("stories_status_idx").on(t.status),
    createdAtIdx: index("stories_created_at_idx").on(t.createdAt),
  }),
);

export const scenes = sqliteTable(
  "scenes",
  {
    id: id(),
    storyId: text("story_id").notNull(),
    orderIndex: integer("order_index").notNull(),
    title: text("title"),
    environment: text("environment"),
    environmentLockNotes: text("environment_lock_notes"),
    transitionToNext: text("transition_to_next"),
    charactersJson: text("characters_json", { mode: "json" })
      .$type<SceneCharacterRef[]>(),
    missingEntitiesJson: text("missing_entities_json", { mode: "json" })
      .$type<string[]>(),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => ({
    storyOrderIdx: index("scenes_story_order_idx").on(t.storyId, t.orderIndex),
  }),
);

export const frames = sqliteTable(
  "frames",
  {
    id: id(),
    sceneId: text("scene_id").notNull(),
    orderIndex: integer("order_index").notNull(),
    frameType: text("frame_type").$type<FrameType>().notNull().default("slide"),
    textOverlay: text("text_overlay"),
    caption: text("caption"),
    imagePrompt: text("image_prompt"),
    status: text("status").$type<FrameStatus>().notNull().default("draft"),
    transparencyMode: text("transparency_mode")
      .$type<TransparencyMode>()
      .notNull()
      .default("opaque"),
    currentRenditionId: text("current_rendition_id"),
    previousRenditionId: text("previous_rendition_id"),
    needsRegen: integer("needs_regen", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => ({
    sceneOrderIdx: index("frames_scene_order_idx").on(t.sceneId, t.orderIndex),
    statusIdx: index("frames_status_idx").on(t.status),
  }),
);

export const renditions = sqliteTable(
  "renditions",
  {
    id: id(),
    frameId: text("frame_id").notNull(),
    imageKey: text("image_key").notNull(),
    imageUrl: text("image_url").notNull(),
    model: text("model").notNull(),
    paramsJson: text("params_json", { mode: "json" }).$type<RenditionParams>().notNull(),
    qcReportJson: text("qc_report_json", { mode: "json" }).$type<QcReport>(),
    embedding: blob("embedding"),
    costUsd: integer("cost_usd_cents"),
    generatedAt: text("generated_at").notNull().default(now),
  },
  (t) => ({
    frameIdx: index("renditions_frame_idx").on(t.frameId),
  }),
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: id(),
    kind: text("kind").$type<JobKind>().notNull(),
    refTable: text("ref_table"),
    refId: text("ref_id"),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    inngestEventId: text("inngest_event_id"),
    payloadJson: text("payload_json", { mode: "json" }),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => ({
    kindStatusIdx: index("jobs_kind_status_idx").on(t.kind, t.status),
    refIdx: index("jobs_ref_idx").on(t.refTable, t.refId),
    createdAtIdx: index("jobs_created_at_idx").on(t.createdAt),
  }),
);

export type Template = typeof templates.$inferSelect;
export type InsertTemplate = typeof templates.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;
export type PromptRevision = typeof promptRevisions.$inferSelect;
export type InsertPromptRevision = typeof promptRevisions.$inferInsert;
export type Character = typeof characters.$inferSelect;
export type InsertCharacter = typeof characters.$inferInsert;
export type Asset = typeof assets.$inferSelect;
export type InsertAsset = typeof assets.$inferInsert;
export type Story = typeof stories.$inferSelect;
export type InsertStory = typeof stories.$inferInsert;
export type Scene = typeof scenes.$inferSelect;
export type InsertScene = typeof scenes.$inferInsert;
export type Frame = typeof frames.$inferSelect;
export type InsertFrame = typeof frames.$inferInsert;
export type Rendition = typeof renditions.$inferSelect;
export type InsertRendition = typeof renditions.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type InsertJob = typeof jobs.$inferInsert;

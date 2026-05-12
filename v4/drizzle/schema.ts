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
  AssetVariantBbox,
  AssetVariantKind,
  AssetVariantMetadata,
  AttachmentRef,
  AttachmentScope,
  CharacterOrigin,
  FrameMetadata,
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
  SectionKind,
  StoryKind,
  StoryStatus,
  TagAxes,
  TemplateDefaults,
  TemplateKind,
  TemplateUiHints,
  TransparencyMode,
  WorldStyleTokens,
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
    /** Vision-extracted (or hand-edited) style anchor that's prepended to every
     * frame's image prompt at generate time. Stories can override. */
    styleAnchorText: text("style_anchor_text"),
    styleAnchorStructuredJson: text("style_anchor_structured_json", { mode: "json" }),
    styleAnchorUpdatedAt: text("style_anchor_updated_at"),
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

export const worlds = sqliteTable(
  "worlds",
  {
    id: id(),
    name: text("name").notNull(),
    description: text("description"),
    styleTokensJson: text("style_tokens_json", { mode: "json" })
      .$type<WorldStyleTokens>(),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => ({
    nameIdx: uniqueIndex("worlds_name_idx").on(t.name),
  }),
);

export const characters = sqliteTable(
  "characters",
  {
    id: id(),
    projectId: text("project_id"),
    worldId: text("world_id"),
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
    worldIdx: index("characters_world_idx").on(t.worldId),
    nameIdx: index("characters_name_idx").on(t.name),
  }),
);

export const assets = sqliteTable(
  "assets",
  {
    id: id(),
    projectId: text("project_id"),
    worldId: text("world_id"),
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
    worldIdx: index("assets_world_idx").on(t.worldId),
    characterIdx: index("assets_character_idx").on(t.characterId),
    kindIdx: index("assets_kind_idx").on(t.kind),
    contentHashIdx: uniqueIndex("assets_content_hash_idx").on(t.contentHash),
  }),
);

export const assetVariants = sqliteTable(
  "asset_variants",
  {
    id: id(),
    parentAssetId: text("parent_asset_id").notNull(),
    kind: text("kind").$type<AssetVariantKind>().notNull(),
    name: text("name").notNull(),
    imageKey: text("image_key"),
    imageUrl: text("image_url"),
    bboxJson: text("bbox_json", { mode: "json" }).$type<AssetVariantBbox>(),
    metadataJson: text("metadata_json", { mode: "json" })
      .$type<AssetVariantMetadata>(),
    embedding: blob("embedding"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => ({
    parentIdx: index("asset_variants_parent_idx").on(t.parentAssetId),
    kindIdx: index("asset_variants_kind_idx").on(t.kind),
  }),
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: id(),
    scope: text("scope").$type<AttachmentScope>().notNull(),
    scopeId: text("scope_id").notNull(),
    ref: text("ref").$type<AttachmentRef>().notNull(),
    refId: text("ref_id").notNull(),
    role: text("role"),
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => ({
    scopeIdx: index("attachments_scope_idx").on(t.scope, t.scopeId),
    refIdx: index("attachments_ref_idx").on(t.ref, t.refId),
    uniqIdx: uniqueIndex("attachments_uniq_idx").on(
      t.scope,
      t.scopeId,
      t.ref,
      t.refId,
    ),
  }),
);

export const stories = sqliteTable(
  "stories",
  {
    id: id(),
    projectId: text("project_id"),
    kind: text("kind").$type<StoryKind>().notNull().default("story"),
    title: text("title").notNull(),
    sourceText: text("source_text").notNull().default(""),
    status: text("status").$type<StoryStatus>().notNull().default("draft"),
    settingsJson: text("settings_json", { mode: "json" }).$type<ProjectSettings>(),
    worldSnapshotJson: text("world_snapshot_json", { mode: "json" }),
    /** Optional per-story override. Falls back to project.styleAnchorText. */
    styleAnchorText: text("style_anchor_text"),
    styleAnchorStructuredJson: text("style_anchor_structured_json", { mode: "json" }),
    styleAnchorUpdatedAt: text("style_anchor_updated_at"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => ({
    projectIdx: index("stories_project_idx").on(t.projectId),
    statusIdx: index("stories_status_idx").on(t.status),
    kindIdx: index("stories_kind_idx").on(t.kind),
    createdAtIdx: index("stories_created_at_idx").on(t.createdAt),
  }),
);

export const storyVariants = sqliteTable(
  "story_variants",
  {
    id: id(),
    storyId: text("story_id").notNull(),
    name: text("name").notNull().default("v1"),
    notes: text("notes"),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => ({
    storyIdx: index("story_variants_story_idx").on(t.storyId),
  }),
);

export const scenes = sqliteTable(
  "scenes",
  {
    id: id(),
    storyId: text("story_id").notNull(),
    storyVariantId: text("story_variant_id"),
    orderIndex: integer("order_index").notNull(),
    title: text("title"),
    environment: text("environment"),
    environmentLockNotes: text("environment_lock_notes"),
    transitionToNext: text("transition_to_next"),
    charactersJson: text("characters_json", { mode: "json" })
      .$type<SceneCharacterRef[]>(),
    missingEntitiesJson: text("missing_entities_json", { mode: "json" })
      .$type<string[]>(),
    sectionKind: text("section_kind").$type<SectionKind>(),
    pageNumber: integer("page_number"),
    chapterTitle: text("chapter_title"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => ({
    storyOrderIdx: index("scenes_story_order_idx").on(t.storyId, t.orderIndex),
    variantIdx: index("scenes_variant_idx").on(t.storyVariantId),
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
    /** Atlas prediction id we're waiting on. Null when nothing pending. */
    pendingPredictionId: text("pending_prediction_id"),
    /** Atlas model the pending job was submitted to (text-to-image or edit). */
    pendingModel: text("pending_model"),
    /** Persisted submit params so the poller can finalize the rendition row. */
    pendingParamsJson: text("pending_params_json", { mode: "json" }).$type<RenditionParams>(),
    /** ISO timestamp when generate was submitted — for UI elapsed display. */
    pendingStartedAt: text("pending_started_at"),
    /** Bag for hand-tuned book-page provenance (negative_prompt, aspect_ratio,
     * style_refs, didactic_role) plus any future per-frame metadata. */
    metadataJson: text("metadata_json", { mode: "json" }).$type<FrameMetadata>(),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => ({
    sceneOrderIdx: index("frames_scene_order_idx").on(t.sceneId, t.orderIndex),
    statusIdx: index("frames_status_idx").on(t.status),
    pendingIdx: index("frames_pending_idx").on(t.pendingPredictionId),
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
export type World = typeof worlds.$inferSelect;
export type InsertWorld = typeof worlds.$inferInsert;
export type Character = typeof characters.$inferSelect;
export type InsertCharacter = typeof characters.$inferInsert;
export type Asset = typeof assets.$inferSelect;
export type InsertAsset = typeof assets.$inferInsert;
export type AssetVariant = typeof assetVariants.$inferSelect;
export type InsertAssetVariant = typeof assetVariants.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type InsertAttachment = typeof attachments.$inferInsert;
export type Story = typeof stories.$inferSelect;
export type InsertStory = typeof stories.$inferInsert;
export type StoryVariant = typeof storyVariants.$inferSelect;
export type InsertStoryVariant = typeof storyVariants.$inferInsert;
export type Scene = typeof scenes.$inferSelect;
export type InsertScene = typeof scenes.$inferInsert;
export type Frame = typeof frames.$inferSelect;
export type InsertFrame = typeof frames.$inferInsert;
export type Rendition = typeof renditions.$inferSelect;
export type InsertRendition = typeof renditions.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type InsertJob = typeof jobs.$inferInsert;

-- New tables: worlds, asset_variants, attachments, story_variants
CREATE TABLE `worlds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`style_tokens_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worlds_name_idx` ON `worlds` (`name`);--> statement-breakpoint

CREATE TABLE `asset_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`image_key` text,
	`image_url` text,
	`bbox_json` text,
	`metadata_json` text,
	`embedding` blob,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `asset_variants_parent_idx` ON `asset_variants` (`parent_asset_id`);--> statement-breakpoint
CREATE INDEX `asset_variants_kind_idx` ON `asset_variants` (`kind`);--> statement-breakpoint

CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text NOT NULL,
	`ref` text NOT NULL,
	`ref_id` text NOT NULL,
	`role` text,
	`order_index` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attachments_scope_idx` ON `attachments` (`scope`,`scope_id`);--> statement-breakpoint
CREATE INDEX `attachments_ref_idx` ON `attachments` (`ref`,`ref_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_uniq_idx` ON `attachments` (`scope`,`scope_id`,`ref`,`ref_id`);--> statement-breakpoint

CREATE TABLE `story_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`name` text DEFAULT 'v1' NOT NULL,
	`notes` text,
	`is_primary` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `story_variants_story_idx` ON `story_variants` (`story_id`);--> statement-breakpoint

-- Add new nullable columns to existing tables BEFORE creating indexes on them
ALTER TABLE `characters` ADD `world_id` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `world_id` text;--> statement-breakpoint
ALTER TABLE `scenes` ADD `story_variant_id` text;--> statement-breakpoint
ALTER TABLE `stories` ADD `kind` text DEFAULT 'story' NOT NULL;--> statement-breakpoint

-- The old characters_name_idx was on (project_id, name); drop it before recreating on (name) only
DROP INDEX IF EXISTS `characters_name_idx`;--> statement-breakpoint

-- Loosen characters.project_id from NOT NULL to nullable (SQLite recreates the table)
ALTER TABLE `characters` ALTER COLUMN "project_id" TO "project_id" text;--> statement-breakpoint

-- Indexes for the newly-added columns
CREATE INDEX IF NOT EXISTS `assets_world_idx` ON `assets` (`world_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `characters_world_idx` ON `characters` (`world_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `characters_name_idx` ON `characters` (`name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scenes_variant_idx` ON `scenes` (`story_variant_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `stories_kind_idx` ON `stories` (`kind`);

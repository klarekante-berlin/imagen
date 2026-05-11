CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`character_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`image_key` text NOT NULL,
	`image_url` text NOT NULL,
	`content_hash` text,
	`visual_description` text,
	`tag_axes_json` text,
	`tags_json` text,
	`metadata_json` text,
	`embedding` blob,
	`source_rendition_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assets_project_idx` ON `assets` (`project_id`);--> statement-breakpoint
CREATE INDEX `assets_character_idx` ON `assets` (`character_id`);--> statement-breakpoint
CREATE INDEX `assets_kind_idx` ON `assets` (`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `assets_content_hash_idx` ON `assets` (`content_hash`);--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`aliases_json` text,
	`description` text,
	`persona` text,
	`traits_json` text,
	`primary_asset_id` text,
	`origin` text DEFAULT 'user' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `characters_project_idx` ON `characters` (`project_id`);--> statement-breakpoint
CREATE INDEX `characters_name_idx` ON `characters` (`project_id`,`name`);--> statement-breakpoint
CREATE TABLE `frames` (
	`id` text PRIMARY KEY NOT NULL,
	`scene_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`frame_type` text DEFAULT 'slide' NOT NULL,
	`text_overlay` text,
	`caption` text,
	`image_prompt` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`transparency_mode` text DEFAULT 'opaque' NOT NULL,
	`current_rendition_id` text,
	`previous_rendition_id` text,
	`needs_regen` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `frames_scene_order_idx` ON `frames` (`scene_id`,`order_index`);--> statement-breakpoint
CREATE INDEX `frames_status_idx` ON `frames` (`status`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`ref_table` text,
	`ref_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`inngest_event_id` text,
	`payload_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_kind_status_idx` ON `jobs` (`kind`,`status`);--> statement-breakpoint
CREATE INDEX `jobs_ref_idx` ON `jobs` (`ref_table`,`ref_id`);--> statement-breakpoint
CREATE INDEX `jobs_created_at_idx` ON `jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`template_id` text NOT NULL,
	`settings_json` text,
	`active_prompt_ids_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_name_idx` ON `projects` (`name`);--> statement-breakpoint
CREATE INDEX `projects_template_idx` ON `projects` (`template_id`);--> statement-breakpoint
CREATE TABLE `prompt_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`text` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prompt_rev_project_key_idx` ON `prompt_revisions` (`project_id`,`key`);--> statement-breakpoint
CREATE TABLE `renditions` (
	`id` text PRIMARY KEY NOT NULL,
	`frame_id` text NOT NULL,
	`image_key` text NOT NULL,
	`image_url` text NOT NULL,
	`model` text NOT NULL,
	`params_json` text NOT NULL,
	`qc_report_json` text,
	`embedding` blob,
	`cost_usd_cents` integer,
	`generated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `renditions_frame_idx` ON `renditions` (`frame_id`);--> statement-breakpoint
CREATE TABLE `scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`title` text,
	`environment` text,
	`environment_lock_notes` text,
	`transition_to_next` text,
	`characters_json` text,
	`missing_entities_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scenes_story_order_idx` ON `scenes` (`story_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`source_text` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`settings_json` text,
	`world_snapshot_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stories_project_idx` ON `stories` (`project_id`);--> statement-breakpoint
CREATE INDEX `stories_status_idx` ON `stories` (`status`);--> statement-breakpoint
CREATE INDEX `stories_created_at_idx` ON `stories` (`created_at`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`defaults_json` text NOT NULL,
	`ui_hints_json` text,
	`is_built_in` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_name_idx` ON `templates` (`name`);
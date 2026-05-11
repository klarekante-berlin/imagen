CREATE TABLE `assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'sonstiges' NOT NULL,
	`description` text,
	`imageKey` text NOT NULL,
	`imageUrl` text NOT NULL,
	`visualDescription` text,
	`tags` text,
	`characterId` integer,
	`isCharacterSheet` integer DEFAULT false NOT NULL,
	`pose` text,
	`outfit` text,
	`setting` text,
	`mood` text,
	`dominantColors` text,
	`variants` text,
	`contentHash` text,
	`sourcePath` text,
	`autoCategorized` integer DEFAULT false NOT NULL,
	`visionConfidence` integer,
	`reviewStatus` text DEFAULT 'approved' NOT NULL,
	`embedding` blob,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assets_character_idx` ON `assets` (`characterId`);--> statement-breakpoint
CREATE INDEX `assets_category_idx` ON `assets` (`category`);--> statement-breakpoint
CREATE UNIQUE INDEX `assets_content_hash_idx` ON `assets` (`contentHash`);--> statement-breakpoint
CREATE INDEX `assets_review_status_idx` ON `assets` (`reviewStatus`);--> statement-breakpoint
CREATE INDEX `assets_source_path_idx` ON `assets` (`sourcePath`);--> statement-breakpoint
CREATE TABLE `characters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`aliases` text,
	`kind` text DEFAULT 'family' NOT NULL,
	`defaultDescription` text,
	`defaultStyleNotes` text,
	`primaryAssetId` integer,
	`createdByStoryId` integer,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `characters_name_idx` ON `characters` (`name`);--> statement-breakpoint
CREATE INDEX `characters_kind_idx` ON `characters` (`kind`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`imageFormat` text DEFAULT '1:1' NOT NULL,
	`planSystemPrompt` text NOT NULL,
	`writeSystemPrompt` text NOT NULL,
	`globalStylePrompt` text NOT NULL,
	`allowedAssetCategories` text,
	`minFrames` integer DEFAULT 1 NOT NULL,
	`maxFrames` integer DEFAULT 10 NOT NULL,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_name_idx` ON `projects` (`name`);--> statement-breakpoint
CREATE TABLE `slides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`storyId` integer NOT NULL,
	`slideNumber` integer NOT NULL,
	`textContent` text,
	`caption` text,
	`charactersInSlide` text,
	`sceneId` text,
	`imagePrompt` text,
	`imageKey` text,
	`imageUrl` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`needsRegen` integer DEFAULT false NOT NULL,
	`selectedVariants` text,
	`jobId` text,
	`retryCount` integer DEFAULT 0 NOT NULL,
	`errorMessage` text,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `slides_story_idx` ON `slides` (`storyId`);--> statement-breakpoint
CREATE INDEX `slides_scene_id_idx` ON `slides` (`sceneId`);--> statement-breakpoint
CREATE INDEX `slides_job_idx` ON `slides` (`jobId`);--> statement-breakpoint
CREATE TABLE `stories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`projectId` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`theme` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`model` text DEFAULT 'claude-sonnet-4-6' NOT NULL,
	`imageProvider` text DEFAULT 'gpt-image-2' NOT NULL,
	`imageFormat` text DEFAULT '1:1' NOT NULL,
	`consistencyContext` text,
	`usedAssetIds` text,
	`createdAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updatedAt` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stories_status_idx` ON `stories` (`status`);--> statement-breakpoint
CREATE INDEX `stories_project_idx` ON `stories` (`projectId`);--> statement-breakpoint
CREATE INDEX `stories_created_at_idx` ON `stories` (`createdAt`);
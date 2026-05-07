CREATE TABLE `characters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`aliases` json,
	`kind` enum('family','public_figure','fictional','world-built') NOT NULL DEFAULT 'family',
	`defaultDescription` text,
	`defaultStyleNotes` text,
	`primaryAssetId` int,
	`createdByStoryId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `characters_id` PRIMARY KEY(`id`),
	CONSTRAINT `characters_name_idx` UNIQUE(`name`)
);
--> statement-breakpoint
ALTER TABLE `assets` ADD `characterId` int;--> statement-breakpoint
ALTER TABLE `assets` ADD `isCharacterSheet` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `pose` varchar(128);--> statement-breakpoint
ALTER TABLE `assets` ADD `outfit` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `setting` varchar(255);--> statement-breakpoint
ALTER TABLE `assets` ADD `mood` varchar(64);--> statement-breakpoint
ALTER TABLE `assets` ADD `dominantColors` json;--> statement-breakpoint
ALTER TABLE `assets` ADD `contentHash` varchar(64);--> statement-breakpoint
ALTER TABLE `assets` ADD `sourcePath` varchar(1024);--> statement-breakpoint
ALTER TABLE `assets` ADD `autoCategorized` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD `visionConfidence` int;--> statement-breakpoint
ALTER TABLE `assets` ADD `reviewStatus` enum('pending','approved','needs_review') DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE `assets` ADD CONSTRAINT `assets_content_hash_idx` UNIQUE(`contentHash`);--> statement-breakpoint
CREATE INDEX `characters_kind_idx` ON `characters` (`kind`);--> statement-breakpoint
CREATE INDEX `assets_character_idx` ON `assets` (`characterId`);--> statement-breakpoint
CREATE INDEX `assets_review_status_idx` ON `assets` (`reviewStatus`);--> statement-breakpoint
CREATE INDEX `assets_source_path_idx` ON `assets` (`sourcePath`);
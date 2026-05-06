CREATE TABLE `assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`category` enum('familie','historisch','sport','musik','politiker','tech-ceo','tiere','umgebungen','fahrzeuge','items','sonstiges') NOT NULL DEFAULT 'sonstiges',
	`description` text,
	`imageKey` varchar(512) NOT NULL,
	`imageUrl` varchar(1024) NOT NULL,
	`visualDescription` text,
	`tags` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `slides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`storyId` int NOT NULL,
	`slideNumber` int NOT NULL,
	`textContent` text,
	`caption` text,
	`charactersInSlide` json,
	`imagePrompt` text,
	`imageKey` varchar(512),
	`imageUrl` varchar(1024),
	`status` enum('pending','generating','complete','error') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `slides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(512) NOT NULL,
	`theme` text NOT NULL,
	`status` enum('draft','generating_text','generating_images','complete','error') NOT NULL DEFAULT 'draft',
	`model` enum('claude-sonnet-4-5','claude-opus-4-5') NOT NULL DEFAULT 'claude-sonnet-4-5',
	`imageProvider` enum('gpt-image-2','freepik') NOT NULL DEFAULT 'gpt-image-2',
	`imageFormat` enum('1:1','4:5') NOT NULL DEFAULT '1:1',
	`consistencyContext` json,
	`usedAssetIds` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stories_id` PRIMARY KEY(`id`)
);

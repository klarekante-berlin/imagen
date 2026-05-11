CREATE INDEX `assets_category_idx` ON `assets` (`category`);--> statement-breakpoint
CREATE INDEX `slides_story_idx` ON `slides` (`storyId`);--> statement-breakpoint
CREATE INDEX `stories_status_idx` ON `stories` (`status`);--> statement-breakpoint
CREATE INDEX `stories_created_at_idx` ON `stories` (`createdAt`);
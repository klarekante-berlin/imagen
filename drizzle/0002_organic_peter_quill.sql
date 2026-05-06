ALTER TABLE `assets` MODIFY COLUMN `tags` json;--> statement-breakpoint
ALTER TABLE `slides` MODIFY COLUMN `charactersInSlide` json;--> statement-breakpoint
ALTER TABLE `stories` MODIFY COLUMN `usedAssetIds` json;
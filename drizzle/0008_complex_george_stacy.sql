ALTER TABLE `slides` ADD `sceneId` varchar(64);--> statement-breakpoint
CREATE INDEX `slides_scene_id_idx` ON `slides` (`sceneId`);
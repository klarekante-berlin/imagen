ALTER TABLE `frames` ADD `pending_prediction_id` text;--> statement-breakpoint
ALTER TABLE `frames` ADD `pending_model` text;--> statement-breakpoint
ALTER TABLE `frames` ADD `pending_params_json` text;--> statement-breakpoint
ALTER TABLE `frames` ADD `pending_started_at` text;--> statement-breakpoint
CREATE INDEX `frames_pending_idx` ON `frames` (`pending_prediction_id`);
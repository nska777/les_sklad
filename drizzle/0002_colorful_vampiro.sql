CREATE TABLE `activity_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_name` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`operator` text DEFAULT 'Кладовщик' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_activity_logs_created_at` ON `activity_logs` (`created_at`);--> statement-breakpoint
ALTER TABLE `racks` ADD `archived` integer DEFAULT false NOT NULL;
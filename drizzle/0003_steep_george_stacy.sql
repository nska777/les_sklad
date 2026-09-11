CREATE TABLE `warehouse_document_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`product_id` text NOT NULL,
	`planned_quantity` real NOT NULL,
	`processed_quantity` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `warehouse_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_warehouse_document_lines_document` ON `warehouse_document_lines` (`document_id`);--> statement-breakpoint
CREATE TABLE `warehouse_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`counterparty` text DEFAULT '' NOT NULL,
	`recipient` text DEFAULT '' NOT NULL,
	`one_c_id` text,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`created_by` text DEFAULT 'Кладовщик' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warehouse_documents_number_unique` ON `warehouse_documents` (`number`);--> statement-breakpoint
CREATE INDEX `idx_warehouse_documents_type_status` ON `warehouse_documents` (`type`,`status`);--> statement-breakpoint
CREATE INDEX `idx_warehouse_documents_created_at` ON `warehouse_documents` (`created_at`);--> statement-breakpoint
ALTER TABLE `movements` ADD `document_id` text REFERENCES warehouse_documents(id);--> statement-breakpoint
ALTER TABLE `movements` ADD `recipient` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `comment` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_movements_document_id` ON `movements` (`document_id`);
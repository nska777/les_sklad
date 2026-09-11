CREATE TABLE `cells` (
	`id` text PRIMARY KEY NOT NULL,
	`rack_id` text NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`row_index` integer NOT NULL,
	`column_index` integer NOT NULL,
	`blocked` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`rack_id`) REFERENCES `racks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cells_code_unique` ON `cells` (`code`);--> statement-breakpoint
CREATE TABLE `movements` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`product_id` text NOT NULL,
	`cell_id` text NOT NULL,
	`quantity` real NOT NULL,
	`operator` text DEFAULT 'Кладовщик' NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cell_id`) REFERENCES `cells`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sku` text NOT NULL,
	`barcode` text NOT NULL,
	`category` text DEFAULT 'Фурнитура' NOT NULL,
	`unit` text DEFAULT 'шт.' NOT NULL,
	`pack_qty` real DEFAULT 1 NOT NULL,
	`image_url` text DEFAULT '' NOT NULL,
	`min_stock` real DEFAULT 0 NOT NULL,
	`one_c_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_barcode_unique` ON `products` (`barcode`);--> statement-breakpoint
CREATE TABLE `racks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`rows` integer NOT NULL,
	`columns` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `racks_code_unique` ON `racks` (`code`);--> statement-breakpoint
CREATE TABLE `stocks` (
	`product_id` text NOT NULL,
	`cell_id` text NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`product_id`, `cell_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cell_id`) REFERENCES `cells`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_cells_rack_position` ON `cells` (`rack_id`,`row_index`,`column_index`);--> statement-breakpoint
CREATE INDEX `idx_movements_created_at` ON `movements` (`created_at`);--> statement-breakpoint
PRAGMA optimize;

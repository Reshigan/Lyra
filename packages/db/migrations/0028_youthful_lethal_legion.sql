CREATE TABLE `axis_telemetry_points` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`subject_ref` text NOT NULL,
	`source` text NOT NULL,
	`at` integer NOT NULL,
	`value` real NOT NULL,
	`txn_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `axis_telem_point_uq` ON `axis_telemetry_points` (`tenant_id`,`subject_ref`,`source`,`at`);--> statement-breakpoint
CREATE INDEX `axis_telem_subject_idx` ON `axis_telemetry_points` (`tenant_id`,`subject_ref`,`source`,`at`);
CREATE TABLE `analytics_egress_days` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`day` text NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_egress_days_uq` ON `analytics_egress_days` (`tenant_id`,`day`);
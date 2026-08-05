CREATE TABLE `north_alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`metric_key` text NOT NULL,
	`operator` text NOT NULL,
	`threshold_value` integer NOT NULL,
	`window_grain` text DEFAULT 'day' NOT NULL,
	`notify_channel_ref` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `north_alert_rules_tenant_idx` ON `north_alert_rules` (`tenant_id`,`metric_key`);
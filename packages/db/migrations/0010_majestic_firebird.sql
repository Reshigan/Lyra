CREATE TABLE `core_feature_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`description` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`rollout_percent` integer DEFAULT 0 NOT NULL,
	`target_tenant_ids_json` text,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `core_feature_flags_key_unique` ON `core_feature_flags` (`key`);
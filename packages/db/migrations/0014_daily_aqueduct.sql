CREATE TABLE `axis_ops_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`value_json` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `axis_ops_policies_key_uq` ON `axis_ops_policies` (`tenant_id`,`key`);
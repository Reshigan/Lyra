CREATE TABLE `orbit_channel_connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider` text NOT NULL,
	`transport` text NOT NULL,
	`label` text NOT NULL,
	`secrets_json` text NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `orbit_channel_connectors_tenant_idx` ON `orbit_channel_connectors` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `orbit_channel_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`handle` text NOT NULL,
	`customer_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orbit_channel_identities_handle_uq` ON `orbit_channel_identities` (`tenant_id`,`connector_id`,`handle`);--> statement-breakpoint
CREATE INDEX `orbit_channel_identities_customer_idx` ON `orbit_channel_identities` (`customer_id`);--> statement-breakpoint
ALTER TABLE `orbit_conversations` ADD `connector_id` text;
CREATE TABLE `core_locale_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`locale` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `core_locale_overrides_key_idx` ON `core_locale_overrides` (`tenant_id`,`locale`,`key`);--> statement-breakpoint
CREATE TABLE `core_message_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`channel` text NOT NULL,
	`subject_json` text,
	`body_json` text NOT NULL,
	`variables_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `core_message_templates_key_idx` ON `core_message_templates` (`tenant_id`,`key`,`channel`);
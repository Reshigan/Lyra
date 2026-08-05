CREATE TABLE `core_deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`worker_name` text NOT NULL,
	`version` text NOT NULL,
	`status` text DEFAULT 'success' NOT NULL,
	`deployed_by` text NOT NULL,
	`deployed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_deployments_env_idx` ON `core_deployments` (`environment`,`deployed_at`);--> statement-breakpoint
CREATE TABLE `core_impersonation_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`platform_user_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`approval_id` text NOT NULL,
	`reason` text NOT NULL,
	`started_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `core_impersonation_sessions_platform_idx` ON `core_impersonation_sessions` (`platform_user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `core_impersonation_sessions_tenant_idx` ON `core_impersonation_sessions` (`tenant_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `core_slo_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`description` text NOT NULL,
	`module` text NOT NULL,
	`target_percent` integer NOT NULL,
	`window_days` integer DEFAULT 30 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `core_slo_definitions_key_unique` ON `core_slo_definitions` (`key`);
CREATE TABLE `orbit_agent_presence` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`active_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orbit_agent_presence_uq` ON `orbit_agent_presence` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `orbit_routing_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`team_id` text NOT NULL,
	`seq` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`conditions_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orbit_routing_rules_seq_uq` ON `orbit_routing_rules` (`tenant_id`,`seq`);--> statement-breakpoint
CREATE TABLE `orbit_sla_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`frt_minutes` integer NOT NULL,
	`resolution_minutes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orbit_sla_policies_key_uq` ON `orbit_sla_policies` (`tenant_id`,`key`);--> statement-breakpoint
CREATE TABLE `orbit_team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`skills_json` text DEFAULT '[]' NOT NULL,
	`max_concurrent` integer DEFAULT 5 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orbit_team_members_uq` ON `orbit_team_members` (`tenant_id`,`team_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `orbit_team_members_user_idx` ON `orbit_team_members` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `orbit_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`name_json` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orbit_teams_key_uq` ON `orbit_teams` (`tenant_id`,`key`);--> statement-breakpoint
ALTER TABLE `orbit_conversations` ADD `priority` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `orbit_conversations` ADD `sla_policy_key` text;--> statement-breakpoint
ALTER TABLE `orbit_conversations` ADD `require_skills_json` text;--> statement-breakpoint
ALTER TABLE `orbit_conversations` ADD `queued_at` integer;--> statement-breakpoint
ALTER TABLE `orbit_conversations` ADD `assigned_at` integer;--> statement-breakpoint
ALTER TABLE `orbit_conversations` ADD `first_response_due_at` integer;--> statement-breakpoint
ALTER TABLE `orbit_conversations` ADD `resolution_due_at` integer;--> statement-breakpoint
ALTER TABLE `orbit_conversations` ADD `frt_breached_at` integer;--> statement-breakpoint
ALTER TABLE `orbit_conversations` ADD `resolution_breached_at` integer;--> statement-breakpoint
ALTER TABLE `orbit_conversations` ADD `reopen_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `orbit_conv_queue_idx` ON `orbit_conversations` (`tenant_id`,`team_id`,`state`,`priority`,`queued_at`);
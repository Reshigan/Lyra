CREATE TABLE `ai_command_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`run_id` text NOT NULL,
	`module` text NOT NULL,
	`tool_name` text NOT NULL,
	`subject_ref` text,
	`policy_key` text,
	`args_json` text NOT NULL,
	`why_json` text,
	`state` text DEFAULT 'proposed' NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`approval_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_command_proposals_idx` ON `ai_command_proposals` (`tenant_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_command_proposals_run_idx` ON `ai_command_proposals` (`tenant_id`,`run_id`);

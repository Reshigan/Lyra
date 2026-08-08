CREATE TABLE `axis_bordereau_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`bordereau_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`policy_id` text,
	`policy_version_id` text,
	`claim_id` text,
	`external_ref` text,
	`risk_ref` text,
	`effective_from` integer,
	`effective_to` integer,
	`gross_premium_minor` integer DEFAULT 0 NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`net_premium_minor` integer DEFAULT 0 NOT NULL,
	`commission_minor` integer DEFAULT 0 NOT NULL,
	`claims_paid_minor` integer DEFAULT 0 NOT NULL,
	`reserve_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`match_state` text DEFAULT 'unmatched' NOT NULL,
	`variance_minor` integer DEFAULT 0 NOT NULL,
	`raw_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `axis_bordereau_lines_line_uq` ON `axis_bordereau_lines` (`tenant_id`,`bordereau_id`,`line_no`);--> statement-breakpoint
CREATE INDEX `axis_bordereau_lines_bordereau_idx` ON `axis_bordereau_lines` (`tenant_id`,`bordereau_id`,`match_state`);--> statement-breakpoint
CREATE TABLE `axis_bordereaux` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`direction` text NOT NULL,
	`counterparty_kind` text NOT NULL,
	`counterparty_id` text NOT NULL,
	`kind` text NOT NULL,
	`period` text NOT NULL,
	`currency` text NOT NULL,
	`line_count` integer DEFAULT 0 NOT NULL,
	`gross_premium_minor` integer DEFAULT 0 NOT NULL,
	`commission_minor` integer DEFAULT 0 NOT NULL,
	`claims_paid_minor` integer DEFAULT 0 NOT NULL,
	`reserve_minor` integer DEFAULT 0 NOT NULL,
	`variance_minor` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`file_id` text,
	`source_file_id` text,
	`escrow_batch_id` text,
	`generated_by` text,
	`generated_at` integer,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `axis_bordereaux_period_uq` ON `axis_bordereaux` (`tenant_id`,`direction`,`counterparty_id`,`kind`,`period`);--> statement-breakpoint
CREATE INDEX `axis_bordereaux_tenant_idx` ON `axis_bordereaux` (`tenant_id`,`state`,`period`);
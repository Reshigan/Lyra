CREATE TABLE `axis_complaints` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`ref` text NOT NULL,
	`customer_id` text,
	`policy_id` text,
	`claim_id` text,
	`case_id` text,
	`channel` text NOT NULL,
	`category_code` text NOT NULL,
	`summary_sealed` text,
	`received_at` integer NOT NULL,
	`acknowledged_at` integer,
	`due_at` integer NOT NULL,
	`resolved_at` integer,
	`state` text DEFAULT 'received' NOT NULL,
	`outcome` text,
	`root_cause_code` text,
	`redress_minor` integer DEFAULT 0 NOT NULL,
	`currency` text,
	`regulator_ref` text,
	`owner_ref` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `axis_complaints_ref_uq` ON `axis_complaints` (`tenant_id`,`ref`);--> statement-breakpoint
CREATE INDEX `axis_complaints_due_idx` ON `axis_complaints` (`tenant_id`,`state`,`due_at`);--> statement-breakpoint
CREATE TABLE `axis_referrals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`case_id` text,
	`policy_id` text,
	`quote_response_id` text,
	`kind` text NOT NULL,
	`trigger_json` text NOT NULL,
	`value_minor` integer,
	`currency` text,
	`state` text DEFAULT 'open' NOT NULL,
	`decided_by` text,
	`decision_note` text,
	`counter_terms_json` text,
	`approval_id` text,
	`sla_due_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `axis_referrals_state_idx` ON `axis_referrals` (`tenant_id`,`state`,`sla_due_at`);--> statement-breakpoint
CREATE TABLE `axis_siu_referrals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`policy_id` text,
	`score` integer NOT NULL,
	`reasons_json` text NOT NULL,
	`ai_audit_id` text,
	`source` text DEFAULT 'model' NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`assigned_to` text,
	`outcome` text,
	`saved_minor` integer DEFAULT 0 NOT NULL,
	`currency` text,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `axis_siu_claim_uq` ON `axis_siu_referrals` (`tenant_id`,`claim_id`);--> statement-breakpoint
CREATE INDEX `axis_siu_state_idx` ON `axis_siu_referrals` (`tenant_id`,`state`,`score`);
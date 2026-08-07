CREATE TABLE `axis_claim_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`kind` text NOT NULL,
	`payee_kind` text NOT NULL,
	`payee_ref` text,
	`payee_sealed` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`method` text DEFAULT 'eft' NOT NULL,
	`txn_id` text NOT NULL,
	`approval_id` text,
	`state` text DEFAULT 'requested' NOT NULL,
	`failure_code` text,
	`requested_by` text NOT NULL,
	`requested_at` integer NOT NULL,
	`paid_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `axis_claim_payments_txn_uq` ON `axis_claim_payments` (`tenant_id`,`txn_id`);--> statement-breakpoint
CREATE INDEX `axis_claim_payments_claim_idx` ON `axis_claim_payments` (`tenant_id`,`claim_id`,`state`);--> statement-breakpoint
CREATE TABLE `axis_claim_recoveries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`kind` text NOT NULL,
	`counterparty_ref` text,
	`expected_minor` integer DEFAULT 0 NOT NULL,
	`recovered_minor` integer DEFAULT 0 NOT NULL,
	`fee_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`state` text DEFAULT 'identified' NOT NULL,
	`next_action_at` integer,
	`prospects` integer,
	`txn_id` text,
	`approval_id` text,
	`opened_by` text NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `axis_claim_recoveries_idx` ON `axis_claim_recoveries` (`tenant_id`,`state`,`next_action_at`);--> statement-breakpoint
CREATE TABLE `axis_claim_reserves` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`seq` integer NOT NULL,
	`head` text DEFAULT 'indemnity' NOT NULL,
	`amount_minor` integer NOT NULL,
	`previous_minor` integer DEFAULT 0 NOT NULL,
	`delta_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`basis` text NOT NULL,
	`rationale` text,
	`evidence_json` text,
	`confidence` integer,
	`ai_audit_id` text,
	`approval_id` text,
	`txn_id` text,
	`set_by` text NOT NULL,
	`set_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `axis_claim_reserves_seq_uq` ON `axis_claim_reserves` (`tenant_id`,`claim_id`,`head`,`seq`);--> statement-breakpoint
CREATE INDEX `axis_claim_reserves_claim_idx` ON `axis_claim_reserves` (`tenant_id`,`claim_id`,`set_at`);--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `policy_version_id` text;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `coverage_state` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `coverage_checked_at` integer;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `coverage_json` text;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `peril_code` text;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `cause_code` text;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `cat_code` text;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `reserve_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `paid_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `recovered_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `excess_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `handler_ref` text;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `sla_due_at` integer;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `fraud_score` integer;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `siu_state` text;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `complexity` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `reopened_at` integer;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `closed_at` integer;--> statement-breakpoint
ALTER TABLE `axis_claims` ADD `last_txn_id` text;--> statement-breakpoint
CREATE INDEX `axis_claims_policy_idx` ON `axis_claims` (`tenant_id`,`policy_id`,`reported_at`);--> statement-breakpoint
CREATE TRIGGER `axis_claim_reserves_no_update` BEFORE UPDATE ON `axis_claim_reserves` BEGIN SELECT RAISE(ABORT, 'axis_claim_reserves is append-only: post a correcting movement instead'); END;--> statement-breakpoint
CREATE TRIGGER `axis_claim_reserves_no_delete` BEFORE DELETE ON `axis_claim_reserves` BEGIN SELECT RAISE(ABORT, 'axis_claim_reserves is append-only: post a correcting movement instead'); END

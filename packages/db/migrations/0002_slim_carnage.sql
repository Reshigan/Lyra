CREATE TABLE `core_delegations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`scope_json` text,
	`max_amount_minor` integer,
	`currency` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`revoked_by` text,
	`revoked_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_delegations_to_idx` ON `core_delegations` (`tenant_id`,`to_user_id`,`status`,`ends_at`);--> statement-breakpoint
CREATE INDEX `core_delegations_from_idx` ON `core_delegations` (`tenant_id`,`from_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `core_onboarding_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_ref` text NOT NULL,
	`template` text NOT NULL,
	`key` text NOT NULL,
	`label_json` text NOT NULL,
	`seq` integer NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`gates_stage` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`evidence_kind` text,
	`evidence_ref` text,
	`owner_ref` text,
	`due_at` integer,
	`notes_json` text,
	`waived_approval_id` text,
	`decided_by` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `core_onboarding_steps_uq` ON `core_onboarding_steps` (`tenant_id`,`subject_kind`,`subject_ref`,`key`);--> statement-breakpoint
CREATE INDEX `core_onboarding_steps_subject_idx` ON `core_onboarding_steps` (`tenant_id`,`subject_kind`,`subject_ref`,`seq`);--> statement-breakpoint
CREATE INDEX `core_onboarding_steps_owner_idx` ON `core_onboarding_steps` (`tenant_id`,`owner_ref`,`state`);--> statement-breakpoint
CREATE TABLE `dist_partner_agreements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`partner_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text DEFAULT 'distribution' NOT NULL,
	`terms_json` text NOT NULL,
	`document_file_id` text,
	`signed_by_user_id` text,
	`signed_by_partner_name` text,
	`signed_at` integer,
	`effective_from` integer,
	`effective_to` integer,
	`state` text DEFAULT 'draft' NOT NULL,
	`supersedes_id` text,
	`approval_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dist_partner_agreements_uq` ON `dist_partner_agreements` (`tenant_id`,`partner_id`,`version`);--> statement-breakpoint
CREATE INDEX `dist_partner_agreements_state_idx` ON `dist_partner_agreements` (`tenant_id`,`partner_id`,`state`);--> statement-breakpoint
ALTER TABLE `orbit_partners` ADD `stage` text DEFAULT 'prospect' NOT NULL;--> statement-breakpoint
ALTER TABLE `orbit_partners` ADD `owner_ref` text;--> statement-breakpoint
ALTER TABLE `orbit_partners` ADD `legal_name` text;--> statement-breakpoint
ALTER TABLE `orbit_partners` ADD `registration_no` text;--> statement-breakpoint
ALTER TABLE `orbit_partners` ADD `tax_id` text;--> statement-breakpoint
ALTER TABLE `orbit_partners` ADD `country` text;--> statement-breakpoint
ALTER TABLE `orbit_partners` ADD `screening_id` text;--> statement-breakpoint
ALTER TABLE `orbit_partners` ADD `risk_rating` text;--> statement-breakpoint
ALTER TABLE `orbit_partners` ADD `agreement_id` text;--> statement-breakpoint
ALTER TABLE `orbit_partners` ADD `payout_method_ref` text;--> statement-breakpoint
ALTER TABLE `orbit_partners` ADD `go_live_at` integer;--> statement-breakpoint
ALTER TABLE `orbit_partners` ADD `suspended_at` integer;--> statement-breakpoint
ALTER TABLE `orbit_partners` ADD `suspended_reason` text;--> statement-breakpoint
ALTER TABLE `orbit_partners` ADD `terminated_at` integer;--> statement-breakpoint
CREATE INDEX `orbit_partners_stage_idx` ON `orbit_partners` (`tenant_id`,`stage`);--> statement-breakpoint
CREATE INDEX `orbit_partners_owner_idx` ON `orbit_partners` (`tenant_id`,`owner_ref`);
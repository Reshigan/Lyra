CREATE TABLE `axis_policy_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`policy_id` text NOT NULL,
	`version_seq` integer NOT NULL,
	`endorsement_no` text,
	`reason` text NOT NULL,
	`reason_code` text,
	`effective_from` integer NOT NULL,
	`effective_to` integer NOT NULL,
	`premium_minor` integer NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`fees_minor` integer DEFAULT 0 NOT NULL,
	`commission_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`premium_delta_minor` integer DEFAULT 0 NOT NULL,
	`pro_rata_days` integer,
	`terms_json` text NOT NULL,
	`rating_json` text,
	`quote_response_id` text,
	`txn_id` text,
	`approval_id` text,
	`document_file_id` text,
	`delivered_at` integer,
	`delivery_ref` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`issued_by` text NOT NULL,
	`issued_at` integer NOT NULL,
	`superseded_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `axis_policy_versions_seq_uq` ON `axis_policy_versions` (`tenant_id`,`policy_id`,`version_seq`);--> statement-breakpoint
CREATE INDEX `axis_policy_versions_policy_idx` ON `axis_policy_versions` (`tenant_id`,`policy_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `axis_policy_versions_txn_idx` ON `axis_policy_versions` (`tenant_id`,`txn_id`);--> statement-breakpoint
ALTER TABLE `axis_policies` ADD `current_version_id` text;--> statement-breakpoint
ALTER TABLE `axis_policies` ADD `version_seq` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `axis_policies` ADD `tax_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `axis_policies` ADD `fees_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `axis_policies` ADD `gross_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `axis_policies` ADD `renewed_from_policy_id` text;--> statement-breakpoint
ALTER TABLE `axis_policies` ADD `renewal_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `axis_policies` ADD `incepted_at` integer;--> statement-breakpoint
ALTER TABLE `axis_policies` ADD `lapsed_at` integer;--> statement-breakpoint
ALTER TABLE `axis_policies` ADD `cancelled_at` integer;--> statement-breakpoint
ALTER TABLE `axis_policies` ADD `cancel_reason_code` text;--> statement-breakpoint
ALTER TABLE `axis_policies` ADD `cancel_effective_at` integer;--> statement-breakpoint
ALTER TABLE `axis_policies` ADD `status_reason` text;--> statement-breakpoint
ALTER TABLE `axis_policies` ADD `last_txn_id` text;--> statement-breakpoint
CREATE INDEX `axis_policies_renewal_idx` ON `axis_policies` (`tenant_id`,`renewed_from_policy_id`);--> statement-breakpoint
-- docs/27 F5 backfill. Every policy that existed before versioning gets the v1
-- it would have been issued with, reconstructed from the head's own values, so
-- no policy has an empty history and the §C.2 invariants hold from row one.
-- The id is derived from the policy id: forward-only migrations must be
-- deterministic, and this one has to run identically on D1 and libSQL.
INSERT INTO `axis_policy_versions` (
  `id`, `tenant_id`, `policy_id`, `version_seq`, `reason`,
  `effective_from`, `effective_to`, `premium_minor`, `tax_minor`, `fees_minor`,
  `commission_minor`, `currency`, `premium_delta_minor`, `terms_json`, `state`,
  `issued_by`, `issued_at`, `created_at`, `updated_at`
)
SELECT
  'pver_' || p.`id`, p.`tenant_id`, p.`id`, 1, 'issue',
  p.`start_at`, p.`end_at`, p.`premium_minor`, 0, 0,
  p.`commission_minor`, p.`currency`, 0,
  -- Pre-0016 rows never captured priced terms; the flag says so rather than
  -- letting a reader mistake '{}' for "no cover".
  '{"backfilled":true}', 'effective',
  'system:migration_0016', p.`created_at`, p.`created_at`, p.`updated_at`
FROM `axis_policies` p;--> statement-breakpoint
UPDATE `axis_policies` SET
  `current_version_id` = 'pver_' || `id`,
  `version_seq` = 1,
  `gross_minor` = `premium_minor` + `tax_minor` + `fees_minor`,
  -- A policy already on risk (or past it) incepted at its start date.
  `incepted_at` = CASE WHEN `status` IN ('active','lapsed','renewed','expired')
                       THEN `start_at` ELSE NULL END
WHERE `current_version_id` IS NULL;
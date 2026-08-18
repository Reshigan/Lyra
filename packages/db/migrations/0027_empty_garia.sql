ALTER TABLE `ledger_payment_plans` ADD `missed_streak` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_payment_plans_live_uq` ON `ledger_payment_plans` (`tenant_id`,`subject_ref`) WHERE state IN ('active','defaulted');--> statement-breakpoint
CREATE INDEX `ledger_payments_ref_idx` ON `ledger_payments` (`tenant_id`,`provider_ref`);
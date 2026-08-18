ALTER TABLE `ledger_subscriptions` ADD `next_invoice_at` integer;--> statement-breakpoint
CREATE INDEX `ledger_subscriptions_next_invoice_idx` ON `ledger_subscriptions` (`tenant_id`,`next_invoice_at`);--> statement-breakpoint
ALTER TABLE `ledger_usage_meters` ADD `overage_invoiced_at` integer;
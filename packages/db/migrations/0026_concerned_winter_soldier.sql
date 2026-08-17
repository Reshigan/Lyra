ALTER TABLE `ledger_usage_meters` ADD `overage_invoiced_quantity` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Migration 0025 added next_invoice_at but nothing ever populated it, and
-- SQLite's `NULL <= now` is NULL, not true, so every existing subscription is
-- silently excluded from billing forever. Backfill it.
--
-- Not `start_at`: the invoice engine now catches up every period between
-- next_invoice_at and the clock, so start_at would retroactively raise an
-- invoice for every month since the subscription began, including months
-- already invoiced by hand. The first period nobody could have billed yet is
-- the next one, so that is where these rows resume.
UPDATE `ledger_subscriptions`
SET `next_invoice_at` = MAX(
  `start_at`,
  CAST(strftime('%s', date('now', 'start of month', '+1 month')) AS INTEGER) * 1000
)
WHERE `next_invoice_at` IS NULL AND `state` = 'active';

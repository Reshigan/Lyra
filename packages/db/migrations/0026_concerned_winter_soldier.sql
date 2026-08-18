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
--
-- A yearly subscription's term is not up next month, though: its price is the
-- whole year and that year is already invoiced, so resuming it at the month
-- boundary bills a second full year eleven months early. Each row therefore
-- resumes no earlier than one of its own terms after it started.
UPDATE `ledger_subscriptions`
SET `next_invoice_at` = MAX(
  CASE `interval`
    WHEN 'year' THEN CAST(strftime('%s', datetime(`start_at` / 1000, 'unixepoch', '+1 year')) AS INTEGER) * 1000
    ELSE `start_at`
  END,
  CAST(strftime('%s', date('now', 'start of month', '+1 month')) AS INTEGER) * 1000
)
WHERE `next_invoice_at` IS NULL AND `state` = 'active';

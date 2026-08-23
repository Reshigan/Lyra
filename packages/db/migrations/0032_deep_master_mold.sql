-- 0031's ai_command_proposals statements are deliberately absent: the
-- snapshot that commit missed meant drizzle re-derived them here. Databases
-- that applied 0031 already have the table; repeating it would fail mid-
-- migration. This file carries only what is genuinely new.
CREATE TABLE `signal_outreach` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`channel` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`text` text NOT NULL,
	`state` text DEFAULT 'pending_approval' NOT NULL,
	`approved_by` text NOT NULL,
	`external_ref` text,
	`converted_ref` text,
	`ai_audit_id` text,
	`ts` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `signal_outreach_tenant_idx` ON `signal_outreach` (`tenant_id`,`ts`);--> statement-breakpoint
CREATE INDEX `signal_outreach_campaign_idx` ON `signal_outreach` (`tenant_id`,`campaign_id`,`state`);--> statement-breakpoint
CREATE INDEX `signal_outreach_customer_idx` ON `signal_outreach` (`tenant_id`,`customer_id`,`ts`);
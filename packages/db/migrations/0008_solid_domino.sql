DROP INDEX `core_users_tenant_idx`;--> statement-breakpoint
DROP INDEX `core_users_tenant_email_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `core_users_tenant_email_uq` ON `core_users` (`tenant_id`,`email`) WHERE deleted_at IS NULL;--> statement-breakpoint
DROP INDEX `axis_cases_ref_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `axis_cases_ref_uq` ON `axis_cases` (`tenant_id`,`ref`) WHERE deleted_at IS NULL;--> statement-breakpoint
DROP INDEX `core_identity_providers_domain_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `core_identity_providers_domain_uq` ON `core_identity_providers` (`tenant_id`,`email_domain`);--> statement-breakpoint
DROP INDEX `dist_channels_key_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `dist_channels_key_uq` ON `dist_channels` (`tenant_id`,`key`) WHERE deleted_at IS NULL;--> statement-breakpoint
DROP INDEX `dist_offerings_code_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `dist_offerings_code_uq` ON `dist_offerings` (`tenant_id`,`provider_id`,`code`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `core_event_outbox_drain_idx` ON `core_event_outbox` (`created_at`) WHERE published_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `dist_commission_entries_accrual_uq` ON `dist_commission_entries` (`tenant_id`,`policy_id`,`kind`) WHERE kind != 'clawback';
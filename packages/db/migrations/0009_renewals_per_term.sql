DROP INDEX `orbit_renewals_policy_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `orbit_renewals_policy_term_uq` ON `orbit_renewals` (`tenant_id`,`policy_ref`,`expiry_at`);

CREATE TABLE `core_identity_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text DEFAULT 'oidc' NOT NULL,
	`name` text NOT NULL,
	`email_domain` text NOT NULL,
	`issuer` text NOT NULL,
	`client_id` text,
	`client_secret_ref` text,
	`discovery_url` text,
	`authorize_url` text,
	`token_url` text,
	`jwks_url` text,
	`sso_url` text,
	`certificate` text,
	`default_role_key` text,
	`enabled` integer DEFAULT false NOT NULL,
	`mfa_asserted` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_identity_providers_tenant_idx` ON `core_identity_providers` (`tenant_id`,`enabled`);--> statement-breakpoint
CREATE UNIQUE INDEX `core_identity_providers_domain_uq` ON `core_identity_providers` (`email_domain`);--> statement-breakpoint
ALTER TABLE `core_users` ADD `mfa_recovery_json` text;--> statement-breakpoint
ALTER TABLE `core_users` ADD `external_id` text;
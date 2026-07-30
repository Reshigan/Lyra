CREATE TABLE `ai_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`module` text NOT NULL,
	`name_json` text NOT NULL,
	`description_json` text,
	`autonomy_level` text DEFAULT 'act_with_approval' NOT NULL,
	`tier` text DEFAULT 'standard' NOT NULL,
	`tools_json` text,
	`guardrails_json` text,
	`prompt_ref` text,
	`status` text DEFAULT 'active' NOT NULL,
	`paused_by` text,
	`paused_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_agents_uq` ON `ai_agents` (`tenant_id`,`key`);--> statement-breakpoint
CREATE TABLE `ai_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`day` text NOT NULL,
	`module` text DEFAULT '*' NOT NULL,
	`tokens_used` integer DEFAULT 0 NOT NULL,
	`cost_micro_used` integer DEFAULT 0 NOT NULL,
	`tokens_limit` integer NOT NULL,
	`cost_micro_limit` integer NOT NULL,
	`threshold_notified_at` integer,
	`stopped_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_budgets_uq` ON `ai_budgets` (`tenant_id`,`day`,`module`);--> statement-breakpoint
CREATE TABLE `ai_evals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`suite` text NOT NULL,
	`case_key` text NOT NULL,
	`agent_key` text NOT NULL,
	`model` text NOT NULL,
	`score` integer NOT NULL,
	`passed` integer NOT NULL,
	`threshold_score` integer NOT NULL,
	`detail_json` text,
	`git_sha` text,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_evals_idx` ON `ai_evals` (`tenant_id`,`suite`,`ts`);--> statement-breakpoint
CREATE TABLE `ai_guardrail_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`run_id` text,
	`rule` text NOT NULL,
	`severity` text DEFAULT 'warn' NOT NULL,
	`detail` text,
	`subject_ref` text,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_guardrail_idx` ON `ai_guardrail_events` (`tenant_id`,`severity`,`ts`);--> statement-breakpoint
CREATE TABLE `ai_knowledge_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`uri` text,
	`file_id` text,
	`locale` text DEFAULT 'en' NOT NULL,
	`pii_level` text DEFAULT 'none' NOT NULL,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`index_namespace` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_indexed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_knowledge_idx` ON `ai_knowledge_sources` (`tenant_id`,`kind`,`status`);--> statement-breakpoint
CREATE TABLE `ai_prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`body` text NOT NULL,
	`variables_json` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_prompts_uq` ON `ai_prompts` (`tenant_id`,`key`,`version`,`locale`);--> statement-breakpoint
CREATE TABLE `ai_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`agent_key` text NOT NULL,
	`module` text NOT NULL,
	`purpose` text NOT NULL,
	`subject_ref` text,
	`actor_ref` text NOT NULL,
	`autonomy_level` text NOT NULL,
	`trigger` text DEFAULT 'user' NOT NULL,
	`state` text DEFAULT 'running' NOT NULL,
	`input_hash` text NOT NULL,
	`output_ref` text,
	`confidence` integer,
	`evidence_json` text,
	`reasoning_ref` text,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`cost_micro` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`approval_id` text,
	`error_code` text,
	`started_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `ai_runs_tenant_idx` ON `ai_runs` (`tenant_id`,`state`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_runs_agent_idx` ON `ai_runs` (`tenant_id`,`agent_key`,`started_at`);--> statement-breakpoint
CREATE INDEX `ai_runs_subject_idx` ON `ai_runs` (`tenant_id`,`subject_ref`);--> statement-breakpoint
CREATE TABLE `ai_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`run_id` text,
	`surface` text NOT NULL,
	`module` text NOT NULL,
	`subject_ref` text,
	`user_id` text NOT NULL,
	`content_ref` text,
	`outcome` text DEFAULT 'shown' NOT NULL,
	`edit_distance` integer,
	`shown_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `ai_suggestions_idx` ON `ai_suggestions` (`tenant_id`,`surface`,`shown_at`);--> statement-breakpoint
CREATE INDEX `ai_suggestions_user_idx` ON `ai_suggestions` (`tenant_id`,`user_id`,`outcome`);--> statement-breakpoint
CREATE TABLE `ai_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`tool` text NOT NULL,
	`args_hash` text NOT NULL,
	`args_redacted_json` text,
	`consequential` integer DEFAULT false NOT NULL,
	`approval_id` text,
	`outcome` text DEFAULT 'ok' NOT NULL,
	`result_hash` text,
	`duration_ms` integer,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_tool_calls_uq` ON `ai_tool_calls` (`tenant_id`,`run_id`,`seq`);--> statement-breakpoint
CREATE TABLE `analytics_dashboards` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`module` text NOT NULL,
	`name_json` text NOT NULL,
	`layout_json` text NOT NULL,
	`scope` text DEFAULT 'tenant' NOT NULL,
	`owner_ref` text,
	`roles_json` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_dashboards_uq` ON `analytics_dashboards` (`tenant_id`,`key`,`scope`,`owner_ref`);--> statement-breakpoint
CREATE TABLE `analytics_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`run_id` text,
	`report_id` text,
	`subject_ref` text,
	`format` text NOT NULL,
	`file_id` text,
	`size_bytes` integer,
	`row_count` integer,
	`pii_masked` integer DEFAULT true NOT NULL,
	`pii_justification` text,
	`watermark` text,
	`requested_by` text NOT NULL,
	`approved_by` text,
	`state` text DEFAULT 'queued' NOT NULL,
	`download_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_exports_idx` ON `analytics_exports` (`tenant_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_exports_requester_idx` ON `analytics_exports` (`tenant_id`,`requested_by`,`created_at`);--> statement-breakpoint
CREATE TABLE `analytics_journey_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`journey_id` text NOT NULL,
	`step` text NOT NULL,
	`actor_ref` text NOT NULL,
	`subject_ref` text,
	`outcome` text DEFAULT 'progressed' NOT NULL,
	`duration_ms` integer,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_journey_events_idx` ON `analytics_journey_events` (`tenant_id`,`journey_id`,`ts`);--> statement-breakpoint
CREATE TABLE `analytics_report_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`report_id` text NOT NULL,
	`params_json` text,
	`requested_by` text NOT NULL,
	`trigger` text DEFAULT 'user' NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`row_count` integer,
	`result_ref` text,
	`truncated` integer DEFAULT false NOT NULL,
	`duration_ms` integer,
	`error` text,
	`expires_at` integer,
	`started_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `analytics_report_runs_idx` ON `analytics_report_runs` (`tenant_id`,`report_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `analytics_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`module` text NOT NULL,
	`name_json` text NOT NULL,
	`description_json` text,
	`definition_json` text NOT NULL,
	`pii_level` text DEFAULT 'none' NOT NULL,
	`required_permission` text NOT NULL,
	`owner_ref` text,
	`scope` text DEFAULT 'tenant' NOT NULL,
	`system` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `analytics_reports_module_idx` ON `analytics_reports` (`tenant_id`,`module`);--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_reports_uq` ON `analytics_reports` (`tenant_id`,`key`,`scope`,`owner_ref`);--> statement-breakpoint
CREATE TABLE `analytics_saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text,
	`route` text NOT NULL,
	`name` text NOT NULL,
	`query_json` text NOT NULL,
	`columns_json` text,
	`is_default` integer DEFAULT false NOT NULL,
	`shared_with_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_saved_views_idx` ON `analytics_saved_views` (`tenant_id`,`route`,`user_id`);--> statement-breakpoint
CREATE TABLE `analytics_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`report_id` text,
	`dashboard_id` text,
	`name_json` text NOT NULL,
	`cron` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Dubai' NOT NULL,
	`format` text DEFAULT 'pdf' NOT NULL,
	`recipients_json` text NOT NULL,
	`params_json` text,
	`locale` text DEFAULT 'en' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_run_at` integer,
	`last_state` text,
	`next_run_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_schedules_due_idx` ON `analytics_schedules` (`tenant_id`,`status`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `analytics_unit_economics` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`day` text NOT NULL,
	`module` text NOT NULL,
	`unit` text NOT NULL,
	`volume` integer DEFAULT 0 NOT NULL,
	`ai_cost_micro` integer DEFAULT 0 NOT NULL,
	`media_cost_micro` integer DEFAULT 0 NOT NULL,
	`human_minutes` integer DEFAULT 0 NOT NULL,
	`revenue_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_unit_econ_uq` ON `analytics_unit_economics` (`tenant_id`,`day`,`module`,`unit`);--> statement-breakpoint
CREATE TABLE `axis_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`approval_id` text NOT NULL,
	`case_id` text NOT NULL,
	`subject_ref` text NOT NULL,
	`policy_key` text NOT NULL,
	`decision` text DEFAULT 'pending' NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `axis_approvals_tenant_idx` ON `axis_approvals` (`tenant_id`,`case_id`,`decision`);--> statement-breakpoint
CREATE TABLE `axis_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`ref` text NOT NULL,
	`kind` text NOT NULL,
	`customer_id` text,
	`product_line` text,
	`channel_id` text,
	`quote_request_id` text,
	`status` text DEFAULT 'intake' NOT NULL,
	`sla_due_at` integer,
	`owner_ref` text,
	`team_id` text,
	`priority` text DEFAULT 'normal' NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`risk_score` integer,
	`value_minor` integer,
	`currency` text,
	`meta_json` text,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `axis_cases_tenant_idx` ON `axis_cases` (`tenant_id`,`status`,`sla_due_at`);--> statement-breakpoint
CREATE INDEX `axis_cases_owner_idx` ON `axis_cases` (`tenant_id`,`owner_ref`,`status`);--> statement-breakpoint
CREATE INDEX `axis_cases_customer_idx` ON `axis_cases` (`tenant_id`,`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `axis_cases_ref_uq` ON `axis_cases` (`tenant_id`,`ref`);--> statement-breakpoint
CREATE TABLE `axis_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`policy_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`case_id` text,
	`claim_no` text NOT NULL,
	`incident_at` integer,
	`reported_at` integer NOT NULL,
	`amount_minor` integer,
	`settled_minor` integer,
	`currency` text NOT NULL,
	`status` text DEFAULT 'reported' NOT NULL,
	`fnol_json` text,
	`assessor_ref` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `axis_claims_tenant_idx` ON `axis_claims` (`tenant_id`,`status`,`reported_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `axis_claims_no_uq` ON `axis_claims` (`tenant_id`,`claim_no`);--> statement-breakpoint
CREATE TABLE `axis_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`case_id` text NOT NULL,
	`file_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`extraction_json` text,
	`extraction_confidence` integer,
	`extraction_model` text,
	`verified_by` text,
	`verified_at` integer,
	`status` text DEFAULT 'received' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `axis_documents_tenant_idx` ON `axis_documents` (`tenant_id`,`case_id`,`doc_type`);--> statement-breakpoint
CREATE TABLE `axis_escrow_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`period` text NOT NULL,
	`provider_id` text NOT NULL,
	`expected_minor` integer DEFAULT 0 NOT NULL,
	`received_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`variance_reason` text,
	`evidence_file_id` text,
	`closed_by` text,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `axis_escrow_uq` ON `axis_escrow_batches` (`tenant_id`,`period`,`provider_id`);--> statement-breakpoint
CREATE TABLE `axis_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`case_id` text,
	`customer_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`product_id` text,
	`offering_id` text,
	`channel_id` text,
	`policy_no` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`premium_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`commission_minor` integer DEFAULT 0 NOT NULL,
	`docs_json` text,
	`escrow_batch_id` text,
	`payment_plan_json` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `axis_policies_tenant_idx` ON `axis_policies` (`tenant_id`,`end_at`);--> statement-breakpoint
CREATE INDEX `axis_policies_customer_idx` ON `axis_policies` (`tenant_id`,`customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `axis_policies_no_uq` ON `axis_policies` (`tenant_id`,`provider_id`,`policy_no`);--> statement-breakpoint
CREATE TABLE `axis_process_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`case_id` text NOT NULL,
	`step` text NOT NULL,
	`actor_ref` text NOT NULL,
	`duration_ms` integer,
	`outcome` text,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `axis_process_events_idx` ON `axis_process_events` (`tenant_id`,`case_id`,`ts`);--> statement-breakpoint
CREATE TABLE `axis_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`case_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`offering_id` text,
	`response_id` text,
	`premium_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`coverage_json` text,
	`valid_until` integer,
	`win_flag` integer DEFAULT false NOT NULL,
	`decline_reason` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `axis_quotes_tenant_idx` ON `axis_quotes` (`tenant_id`,`case_id`);--> statement-breakpoint
CREATE INDEX `axis_quotes_provider_idx` ON `axis_quotes` (`tenant_id`,`provider_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `axis_sops` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`name_json` text NOT NULL,
	`steps_json` text NOT NULL,
	`applies_to` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `axis_sops_uq` ON `axis_sops` (`tenant_id`,`key`,`version`);--> statement-breakpoint
CREATE TABLE `axis_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`case_id` text,
	`type` text NOT NULL,
	`title_key` text NOT NULL,
	`assignee_ref` text,
	`state` text DEFAULT 'open' NOT NULL,
	`due_at` integer,
	`checklist_json` text,
	`created_by` text NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `axis_tasks_tenant_idx` ON `axis_tasks` (`tenant_id`,`state`,`due_at`);--> statement-breakpoint
CREATE INDEX `axis_tasks_assignee_idx` ON `axis_tasks` (`tenant_id`,`assignee_ref`,`state`);--> statement-breakpoint
CREATE TABLE `compliance_disclosures` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`subject_ref` text NOT NULL,
	`customer_id` text,
	`wording_hash` text NOT NULL,
	`wording_ref` text,
	`criteria_json` text,
	`channel` text NOT NULL,
	`acknowledged_at` integer,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_disclosures_idx` ON `compliance_disclosures` (`tenant_id`,`subject_ref`,`ts`);--> statement-breakpoint
CREATE TABLE `compliance_dsar_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text,
	`subject_identifier` text NOT NULL,
	`type` text NOT NULL,
	`channel` text NOT NULL,
	`verification_ref` text,
	`state` text DEFAULT 'received' NOT NULL,
	`due_at` integer NOT NULL,
	`fulfilled_at` integer,
	`refusal_reason` text,
	`bundle_file_id` text,
	`completeness_proof_json` text,
	`handled_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_dsar_idx` ON `compliance_dsar_requests` (`tenant_id`,`state`,`due_at`);--> statement-breakpoint
CREATE TABLE `compliance_erasure_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`dsar_id` text NOT NULL,
	`table_name` text NOT NULL,
	`rows_erased` integer DEFAULT 0 NOT NULL,
	`rows_tombstoned` integer DEFAULT 0 NOT NULL,
	`retained_reason` text,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_erasure_idx` ON `compliance_erasure_log` (`tenant_id`,`dsar_id`);--> statement-breakpoint
CREATE TABLE `compliance_evidence_bundles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`purpose` text NOT NULL,
	`scope_json` text NOT NULL,
	`manifest_json` text NOT NULL,
	`bundle_hash` text NOT NULL,
	`file_id` text,
	`requested_by` text NOT NULL,
	`approved_by` text,
	`state` text DEFAULT 'building' NOT NULL,
	`delivered_to` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_evidence_idx` ON `compliance_evidence_bundles` (`tenant_id`,`state`,`created_at`);--> statement-breakpoint
CREATE TABLE `compliance_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`severity` text DEFAULT 'sev3' NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`affected_json` text,
	`agents_paused` integer DEFAULT false NOT NULL,
	`notifiable_at` integer,
	`notified_at` integer,
	`state` text DEFAULT 'open' NOT NULL,
	`opened_by` text NOT NULL,
	`resolved_at` integer,
	`postmortem_ref` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_incidents_idx` ON `compliance_incidents` (`tenant_id`,`state`,`severity`);--> statement-breakpoint
CREATE TABLE `compliance_legal_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`subject_ref` text NOT NULL,
	`reason` text NOT NULL,
	`authority` text,
	`placed_by` text NOT NULL,
	`released_by` text,
	`released_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_holds_idx` ON `compliance_legal_holds` (`tenant_id`,`subject_ref`,`released_at`);--> statement-breakpoint
CREATE TABLE `compliance_policy_thresholds` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`value_json` text NOT NULL,
	`dual_control` integer DEFAULT false NOT NULL,
	`effective_from` integer NOT NULL,
	`effective_to` integer,
	`set_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compliance_thresholds_uq` ON `compliance_policy_thresholds` (`tenant_id`,`key`,`version`);--> statement-breakpoint
CREATE TABLE `compliance_retention_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`policy_key` text NOT NULL,
	`table_name` text NOT NULL,
	`cutoff_at` integer NOT NULL,
	`rows_affected` integer DEFAULT 0 NOT NULL,
	`rows_held` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'running' NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `compliance_retention_idx` ON `compliance_retention_runs` (`tenant_id`,`policy_key`,`started_at`);--> statement-breakpoint
CREATE TABLE `compliance_rulepack_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`rulepack_id` text NOT NULL,
	`subject_ref` text NOT NULL,
	`rule_key` text NOT NULL,
	`outcome` text NOT NULL,
	`detail_json` text,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_rulepack_app_idx` ON `compliance_rulepack_applications` (`tenant_id`,`subject_ref`,`ts`);--> statement-breakpoint
CREATE TABLE `compliance_screenings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`subject_ref` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`query_hash` text NOT NULL,
	`result` text NOT NULL,
	`hits_json` text,
	`dispositioned_by` text,
	`disposition` text,
	`blocked` integer DEFAULT false NOT NULL,
	`case_ref` text,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_screenings_idx` ON `compliance_screenings` (`tenant_id`,`result`,`ts`);--> statement-breakpoint
CREATE TABLE `ai_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`module` text NOT NULL,
	`purpose` text NOT NULL,
	`model` text NOT NULL,
	`provider` text NOT NULL,
	`tier` text NOT NULL,
	`input_hash` text NOT NULL,
	`output_hash` text,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`cost_micro` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`tool_calls_json` text,
	`guardrail_flags_json` text,
	`actor_ref` text NOT NULL,
	`subject_ref` text,
	`outcome` text DEFAULT 'ok' NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_audit_tenant_idx` ON `ai_audit_log` (`tenant_id`,`ts`);--> statement-breakpoint
CREATE INDEX `ai_audit_module_idx` ON `ai_audit_log` (`tenant_id`,`module`,`ts`);--> statement-breakpoint
CREATE TABLE `core_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`mode` text DEFAULT 'test' NOT NULL,
	`scopes_json` text NOT NULL,
	`created_by` text NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_api_keys_tenant_idx` ON `core_api_keys` (`tenant_id`,`mode`);--> statement-breakpoint
CREATE UNIQUE INDEX `core_api_keys_prefix_uq` ON `core_api_keys` (`prefix`);--> statement-breakpoint
CREATE TABLE `core_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`subject_ref` text NOT NULL,
	`policy_key` text NOT NULL,
	`module` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` integer NOT NULL,
	`decided_by` text,
	`decision` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`context_json` text,
	`decided_at` integer
);
--> statement-breakpoint
CREATE INDEX `core_approvals_tenant_idx` ON `core_approvals` (`tenant_id`,`decision`,`requested_at`);--> statement-breakpoint
CREATE INDEX `core_approvals_subject_idx` ON `core_approvals` (`tenant_id`,`subject_ref`);--> statement-breakpoint
CREATE TABLE `core_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`actor_ref` text NOT NULL,
	`action` text NOT NULL,
	`subject_ref` text,
	`before_hash` text,
	`after_hash` text,
	`prev_hash` text,
	`chain_hash` text NOT NULL,
	`ip` text,
	`ua` text,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_audit_tenant_idx` ON `core_audit_log` (`tenant_id`,`ts`);--> statement-breakpoint
CREATE TABLE `core_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`purposes_json` text NOT NULL,
	`channel_optins_json` text NOT NULL,
	`source` text NOT NULL,
	`evidence_ref` text,
	`ts` integer NOT NULL,
	`expiry` integer,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_consents_tenant_idx` ON `core_consents` (`tenant_id`,`customer_id`,`ts`);--> statement-breakpoint
CREATE TABLE `core_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`type` text DEFAULT 'person' NOT NULL,
	`name_json` text NOT NULL,
	`emails_json` text,
	`phones_json` text,
	`national_id_hash` text,
	`kyc_status` text DEFAULT 'none' NOT NULL,
	`consent_id` text,
	`tags_json` text,
	`ltv_cached` integer,
	`risk_flags_json` text,
	`locale` text DEFAULT 'en' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `core_customers_tenant_idx` ON `core_customers` (`tenant_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `core_customers_natid_idx` ON `core_customers` (`tenant_id`,`national_id_hash`);--> statement-breakpoint
CREATE TABLE `core_event_dlq` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`type` text NOT NULL,
	`consumer` text NOT NULL,
	`envelope_json` text NOT NULL,
	`error` text NOT NULL,
	`attempts` integer NOT NULL,
	`replayed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_event_dlq_tenant_idx` ON `core_event_dlq` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `core_event_inbox` (
	`id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`type` text NOT NULL,
	`consumer` text NOT NULL,
	`processed_at` integer NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'done' NOT NULL,
	PRIMARY KEY(`id`, `consumer`)
);
--> statement-breakpoint
CREATE INDEX `core_event_inbox_tenant_idx` ON `core_event_inbox` (`tenant_id`,`processed_at`);--> statement-breakpoint
CREATE TABLE `core_event_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`module` text NOT NULL,
	`type` text NOT NULL,
	`envelope_json` text NOT NULL,
	`published_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_event_outbox_pending_idx` ON `core_event_outbox` (`tenant_id`,`published_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `core_files` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`kind` text NOT NULL,
	`subject_ref` text,
	`sha256` text NOT NULL,
	`size_bytes` integer,
	`content_type` text,
	`pii_level` text DEFAULT 'none' NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `core_files_tenant_idx` ON `core_files` (`tenant_id`,`subject_ref`);--> statement-breakpoint
CREATE TABLE `core_idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`route` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_json` text,
	`status` text DEFAULT 'in_flight' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `core_idempotency_uq` ON `core_idempotency_keys` (`tenant_id`,`key`,`route`);--> statement-breakpoint
CREATE TABLE `core_identity_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`subject_ref` text NOT NULL,
	`method` text NOT NULL,
	`evidence_level` text NOT NULL,
	`provider_ref` text,
	`expiry` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_identity_verifications_idx` ON `core_identity_verifications` (`tenant_id`,`subject_ref`);--> statement-breakpoint
CREATE TABLE `core_lenses` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`lens_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `core_lenses_user_uq` ON `core_lenses` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `core_mandates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`principal_ref` text NOT NULL,
	`agent_identity` text NOT NULL,
	`scope_json` text NOT NULL,
	`spend_cap_minor` integer,
	`currency` text,
	`verification_ref` text,
	`expiry` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_mandates_tenant_idx` ON `core_mandates` (`tenant_id`,`principal_ref`);--> statement-breakpoint
CREATE TABLE `core_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`subject_ref` text NOT NULL,
	`kind` text NOT NULL,
	`content_json` text NOT NULL,
	`provenance` text NOT NULL,
	`sensitivity` text DEFAULT 'low' NOT NULL,
	`purposes_json` text,
	`expiry` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_memories_idx` ON `core_memories` (`tenant_id`,`subject_ref`,`kind`);--> statement-breakpoint
CREATE TABLE `core_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title_key` text NOT NULL,
	`params_json` text,
	`subject_ref` text,
	`read_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_notifications_user_idx` ON `core_notifications` (`tenant_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `core_products` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`line` text NOT NULL,
	`name_json` text NOT NULL,
	`provider_id` text,
	`terms_ref` text,
	`status` text DEFAULT 'active' NOT NULL,
	`structure` text DEFAULT 'conventional' NOT NULL,
	`takaful_json` text,
	`parametric_trigger_json` text,
	`standard_mapping_json` text,
	`pricing_inputs_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_products_tenant_idx` ON `core_products` (`tenant_id`,`line`);--> statement-breakpoint
CREATE TABLE `core_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'insurer' NOT NULL,
	`is_internal` integer DEFAULT false NOT NULL,
	`lines_json` text,
	`integration_json` text,
	`commission_json` text,
	`settlement_terms_json` text,
	`currency` text,
	`quote_endpoint_json` text,
	`panel_status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_providers_tenant_idx` ON `core_providers` (`tenant_id`,`panel_status`);--> statement-breakpoint
CREATE TABLE `core_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`permissions_json` text NOT NULL,
	`system` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_roles_tenant_idx` ON `core_roles` (`tenant_id`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `core_roles_tenant_key_uq` ON `core_roles` (`tenant_id`,`key`);--> statement-breakpoint
CREATE TABLE `core_rulepacks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`market` text NOT NULL,
	`version` text NOT NULL,
	`effective_at` integer NOT NULL,
	`rules_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_rulepacks_idx` ON `core_rulepacks` (`tenant_id`,`market`,`effective_at`);--> statement-breakpoint
CREATE TABLE `core_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`ip` text,
	`ua` text,
	`mfa_satisfied` integer DEFAULT false NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `core_sessions_tenant_idx` ON `core_sessions` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `core_sessions_token_uq` ON `core_sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `core_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`module_scope` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_teams_tenant_idx` ON `core_teams` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `core_tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`plan` text DEFAULT 'standard' NOT NULL,
	`region` text DEFAULT 'auto' NOT NULL,
	`db_binding` text,
	`status` text DEFAULT 'active' NOT NULL,
	`brand_json` text,
	`policy_json` text,
	`entitlements_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `core_tenants_slug_unique` ON `core_tenants` (`slug`);--> statement-breakpoint
CREATE TABLE `core_user_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`scope_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_user_roles_tenant_idx` ON `core_user_roles` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `core_user_roles_uq` ON `core_user_roles` (`tenant_id`,`user_id`,`role_id`);--> statement-breakpoint
CREATE TABLE `core_users` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`name` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`auth_provider` text DEFAULT 'password' NOT NULL,
	`password_hash` text,
	`mfa_enrolled` integer DEFAULT false NOT NULL,
	`mfa_secret` text,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `core_users_tenant_idx` ON `core_users` (`tenant_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `core_users_tenant_email_uq` ON `core_users` (`tenant_id`,`email`);--> statement-breakpoint
CREATE TABLE `core_webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`webhook_id` text NOT NULL,
	`event_id` text NOT NULL,
	`status` text NOT NULL,
	`response_code` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_webhook_deliveries_idx` ON `core_webhook_deliveries` (`tenant_id`,`webhook_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `core_webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`url` text NOT NULL,
	`event_types_json` text NOT NULL,
	`secret` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `core_webhooks_tenant_idx` ON `core_webhooks` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `dist_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`name_json` text NOT NULL,
	`partner_id` text,
	`medium` text DEFAULT 'web' NOT NULL,
	`collects_payment` text DEFAULT 'us' NOT NULL,
	`settlement_terms_json` text,
	`default_commission_ppm` integer,
	`currency` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dist_channels_key_uq` ON `dist_channels` (`tenant_id`,`key`);--> statement-breakpoint
CREATE INDEX `dist_channels_tenant_idx` ON `dist_channels` (`tenant_id`,`kind`,`status`);--> statement-breakpoint
CREATE INDEX `dist_channels_partner_idx` ON `dist_channels` (`tenant_id`,`partner_id`);--> statement-breakpoint
CREATE TABLE `dist_commission_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`policy_id` text NOT NULL,
	`offering_id` text,
	`provider_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`rate_id` text,
	`kind` text DEFAULT 'new_business' NOT NULL,
	`premium_minor` integer NOT NULL,
	`gross_commission_minor` integer NOT NULL,
	`channel_commission_minor` integer DEFAULT 0 NOT NULL,
	`net_commission_minor` integer NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`earned_on` text DEFAULT 'issue' NOT NULL,
	`earned_at` integer,
	`reversal_of` text,
	`provider_settlement_id` text,
	`channel_settlement_id` text,
	`txn_id` text,
	`state` text DEFAULT 'accrued' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dist_commission_entries_idx` ON `dist_commission_entries` (`tenant_id`,`state`,`earned_at`);--> statement-breakpoint
CREATE INDEX `dist_commission_entries_policy_idx` ON `dist_commission_entries` (`tenant_id`,`policy_id`);--> statement-breakpoint
CREATE INDEX `dist_commission_entries_provider_idx` ON `dist_commission_entries` (`tenant_id`,`provider_id`,`state`);--> statement-breakpoint
CREATE INDEX `dist_commission_entries_channel_idx` ON `dist_commission_entries` (`tenant_id`,`channel_id`,`state`);--> statement-breakpoint
CREATE TABLE `dist_commission_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`offering_id` text,
	`product_id` text,
	`line` text,
	`channel_share_ppm` integer NOT NULL,
	`base_commission_ppm` integer,
	`flat_fee_minor` integer DEFAULT 0 NOT NULL,
	`currency` text,
	`earned_on` text DEFAULT 'issue' NOT NULL,
	`clawback_days` integer DEFAULT 0 NOT NULL,
	`effective_from` integer NOT NULL,
	`effective_to` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dist_commission_rates_idx` ON `dist_commission_rates` (`tenant_id`,`channel_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `dist_commission_rates_offering_idx` ON `dist_commission_rates` (`tenant_id`,`offering_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `dist_next_best_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`kind` text NOT NULL,
	`offering_id` text NOT NULL,
	`anchor_ref` text,
	`channel_id` text,
	`score` integer NOT NULL,
	`expected_value_minor` integer,
	`currency` text,
	`reason_key` text NOT NULL,
	`reason_json` text,
	`run_id` text,
	`model` text,
	`state` text DEFAULT 'proposed' NOT NULL,
	`suppress_reason` text,
	`surfaced_at` integer,
	`decided_at` integer,
	`converted_request_id` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dist_nbo_customer_idx` ON `dist_next_best_offers` (`tenant_id`,`customer_id`,`state`);--> statement-breakpoint
CREATE INDEX `dist_nbo_state_idx` ON `dist_next_best_offers` (`tenant_id`,`state`,`score`);--> statement-breakpoint
CREATE TABLE `dist_offerings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`code` text NOT NULL,
	`name_json` text NOT NULL,
	`currency` text NOT NULL,
	`pricing_mode` text DEFAULT 'api' NOT NULL,
	`rating_inputs_json` text,
	`rating_table_json` text,
	`coverage_json` text,
	`eligibility_json` text,
	`base_commission_ppm` integer DEFAULT 0 NOT NULL,
	`max_discount_ppm` integer DEFAULT 0 NOT NULL,
	`min_premium_minor` integer,
	`max_sum_insured_minor` integer,
	`sla_seconds` integer DEFAULT 30 NOT NULL,
	`channel_keys_json` text,
	`upsell_of_offering_id` text,
	`cross_sell_tags_json` text,
	`status` text DEFAULT 'active' NOT NULL,
	`effective_from` integer NOT NULL,
	`effective_to` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dist_offerings_code_uq` ON `dist_offerings` (`tenant_id`,`provider_id`,`code`);--> statement-breakpoint
CREATE INDEX `dist_offerings_product_idx` ON `dist_offerings` (`tenant_id`,`product_id`,`status`);--> statement-breakpoint
CREATE INDEX `dist_offerings_provider_idx` ON `dist_offerings` (`tenant_id`,`provider_id`,`status`);--> statement-breakpoint
CREATE TABLE `dist_quote_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`case_id` text,
	`customer_id` text,
	`channel_id` text NOT NULL,
	`product_id` text NOT NULL,
	`inputs_json` text NOT NULL,
	`consent_id` text,
	`fanout_count` integer DEFAULT 0 NOT NULL,
	`responded_count` integer DEFAULT 0 NOT NULL,
	`best_offering_id` text,
	`best_premium_minor` integer,
	`currency` text NOT NULL,
	`shared_with_customer_at` integer,
	`state` text DEFAULT 'open' NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dist_quote_requests_idx` ON `dist_quote_requests` (`tenant_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `dist_quote_requests_customer_idx` ON `dist_quote_requests` (`tenant_id`,`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `dist_quote_requests_channel_idx` ON `dist_quote_requests` (`tenant_id`,`channel_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `dist_quote_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`request_id` text NOT NULL,
	`offering_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`premium_minor` integer,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`fees_minor` integer DEFAULT 0 NOT NULL,
	`currency` text,
	`commission_ppm` integer,
	`commission_minor` integer,
	`channel_commission_minor` integer,
	`coverage_json` text,
	`price_rank` integer,
	`value_score` integer,
	`rationale_key` text,
	`decline_reason` text,
	`latency_ms` integer,
	`valid_until` integer,
	`raw_ref` text,
	`selected_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dist_quote_responses_uq` ON `dist_quote_responses` (`tenant_id`,`request_id`,`offering_id`);--> statement-breakpoint
CREATE INDEX `dist_quote_responses_provider_idx` ON `dist_quote_responses` (`tenant_id`,`provider_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `dist_quote_responses_state_idx` ON `dist_quote_responses` (`tenant_id`,`state`,`created_at`);--> statement-breakpoint
CREATE TABLE `ledger_account_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`account_code` text NOT NULL,
	`currency` text NOT NULL,
	`debit_minor` integer DEFAULT 0 NOT NULL,
	`credit_minor` integer DEFAULT 0 NOT NULL,
	`base_debit_minor` integer DEFAULT 0 NOT NULL,
	`base_credit_minor` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_balances_uq` ON `ledger_account_balances` (`tenant_id`,`account_code`,`currency`);--> statement-breakpoint
CREATE TABLE `ledger_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`name_json` text NOT NULL,
	`type` text NOT NULL,
	`normal_side` text NOT NULL,
	`client_money` integer DEFAULT false NOT NULL,
	`currency` text,
	`parent_code` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_accounts_uq` ON `ledger_accounts` (`tenant_id`,`code`);--> statement-breakpoint
CREATE TABLE `ledger_client_money_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`asset_minor` integer NOT NULL,
	`liability_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`shortfall_minor` integer DEFAULT 0 NOT NULL,
	`breach` integer DEFAULT false NOT NULL,
	`triggered_by` text NOT NULL,
	`resolved_at` integer,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_cm_checks_idx` ON `ledger_client_money_checks` (`tenant_id`,`ts`);--> statement-breakpoint
CREATE TABLE `ledger_fx_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`from_currency` text NOT NULL,
	`to_currency` text NOT NULL,
	`rate_ppm` integer NOT NULL,
	`as_of` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_fx_uq` ON `ledger_fx_rates` (`tenant_id`,`from_currency`,`to_currency`,`as_of`);--> statement-breakpoint
CREATE TABLE `ledger_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`number` text NOT NULL,
	`customer_ref` text NOT NULL,
	`subscription_id` text,
	`subtotal_minor` integer NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`total_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`lines_json` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`due_at` integer,
	`issued_at` integer,
	`paid_at` integer,
	`pdf_file_id` text,
	`txn_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_invoices_no_uq` ON `ledger_invoices` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `ledger_invoices_state_idx` ON `ledger_invoices` (`tenant_id`,`state`,`due_at`);--> statement-breakpoint
CREATE TABLE `ledger_journal_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`txn_id` text NOT NULL,
	`period_id` text NOT NULL,
	`currency` text NOT NULL,
	`base_currency` text NOT NULL,
	`fx_rate_ppm` integer DEFAULT 1000000 NOT NULL,
	`total_debit_minor` integer NOT NULL,
	`total_credit_minor` integer NOT NULL,
	`base_total_debit_minor` integer NOT NULL,
	`base_total_credit_minor` integer NOT NULL,
	`reversal_of_batch_id` text,
	`posted_by` text NOT NULL,
	`posted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_batches_tenant_idx` ON `ledger_journal_batches` (`tenant_id`,`posted_at`);--> statement-breakpoint
CREATE INDEX `ledger_batches_period_idx` ON `ledger_journal_batches` (`tenant_id`,`period_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_batches_txn_uq` ON `ledger_journal_batches` (`tenant_id`,`txn_id`);--> statement-breakpoint
CREATE TABLE `ledger_journal_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`txn_id` text NOT NULL,
	`seq` integer NOT NULL,
	`account_code` text NOT NULL,
	`side` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`base_amount_minor` integer NOT NULL,
	`base_currency` text NOT NULL,
	`memo` text,
	`dims_json` text,
	`posted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_lines_account_idx` ON `ledger_journal_lines` (`tenant_id`,`account_code`,`posted_at`);--> statement-breakpoint
CREATE INDEX `ledger_lines_batch_idx` ON `ledger_journal_lines` (`tenant_id`,`batch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_lines_seq_uq` ON `ledger_journal_lines` (`tenant_id`,`batch_id`,`seq`);--> statement-breakpoint
CREATE TABLE `ledger_payment_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`subject_ref` text NOT NULL,
	`financier_ref` text,
	`total_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`instalments` integer NOT NULL,
	`schedule_json` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_payment_plans_idx` ON `ledger_payment_plans` (`tenant_id`,`state`);--> statement-breakpoint
CREATE TABLE `ledger_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`txn_id` text,
	`direction` text NOT NULL,
	`method` text NOT NULL,
	`provider_ref` text,
	`provider_token` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`fee_minor` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`failure_code` text,
	`settlement_batch` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_payments_idx` ON `ledger_payments` (`tenant_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `ledger_payments_batch_idx` ON `ledger_payments` (`tenant_id`,`settlement_batch`);--> statement-breakpoint
CREATE TABLE `ledger_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`checklist_json` text,
	`close_pack_file_id` text,
	`closed_by` text,
	`closed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_periods_uq` ON `ledger_periods` (`tenant_id`,`code`);--> statement-breakpoint
CREATE TABLE `ledger_recon_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`run_id` text NOT NULL,
	`statement_line_ref` text,
	`txn_id` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`delta_minor` integer DEFAULT 0 NOT NULL,
	`method` text NOT NULL,
	`confidence` integer,
	`state` text DEFAULT 'proposed' NOT NULL,
	`reason_code` text,
	`confirmed_by` text,
	`confirmed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_recon_matches_idx` ON `ledger_recon_matches` (`tenant_id`,`run_id`,`state`);--> statement-breakpoint
CREATE TABLE `ledger_recon_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`process` text NOT NULL,
	`period` text NOT NULL,
	`counterparty_ref` text,
	`statement_file_id` text,
	`matched_count` integer DEFAULT 0 NOT NULL,
	`variance_count` integer DEFAULT 0 NOT NULL,
	`variance_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`state` text DEFAULT 'running' NOT NULL,
	`evidence_bundle_file_id` text,
	`closed_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_recon_runs_idx` ON `ledger_recon_runs` (`tenant_id`,`process`,`period`);--> statement-breakpoint
CREATE TABLE `ledger_revenue_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`account_code` text NOT NULL,
	`period` text NOT NULL,
	`planned_minor` integer NOT NULL,
	`recognized_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`txn_id` text,
	`state` text DEFAULT 'scheduled' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_rev_sched_uq` ON `ledger_revenue_schedules` (`tenant_id`,`invoice_id`,`period`,`account_code`);--> statement-breakpoint
CREATE TABLE `ledger_saga_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`txn_id` text NOT NULL,
	`seq` integer NOT NULL,
	`name` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`request_hash` text,
	`result_json` text,
	`compensation_ref` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`started_at` integer,
	`ended_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_saga_steps_uq` ON `ledger_saga_steps` (`tenant_id`,`txn_id`,`seq`);--> statement-breakpoint
CREATE TABLE `ledger_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`counterparty_kind` text NOT NULL,
	`counterparty_ref` text NOT NULL,
	`period` text NOT NULL,
	`gross_minor` integer DEFAULT 0 NOT NULL,
	`adjustments_minor` integer DEFAULT 0 NOT NULL,
	`net_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`statement_file_id` text,
	`state` text DEFAULT 'draft' NOT NULL,
	`approved_by` text,
	`txn_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_settlements_uq` ON `ledger_settlements` (`tenant_id`,`counterparty_kind`,`counterparty_ref`,`period`);--> statement-breakpoint
CREATE TABLE `ledger_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_ref` text NOT NULL,
	`plan` text NOT NULL,
	`edition` text,
	`price_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`interval` text DEFAULT 'month' NOT NULL,
	`seats` integer DEFAULT 1 NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer,
	`state` text DEFAULT 'active' NOT NULL,
	`terms_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_subscriptions_idx` ON `ledger_subscriptions` (`tenant_id`,`state`,`customer_ref`);--> statement-breakpoint
CREATE TABLE `ledger_tax_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`market` text NOT NULL,
	`code` text NOT NULL,
	`rate_ppm` integer NOT NULL,
	`place_of_supply` text,
	`reverse_charge` integer DEFAULT false NOT NULL,
	`exempt` integer DEFAULT false NOT NULL,
	`effective_from` integer NOT NULL,
	`effective_to` integer
);
--> statement-breakpoint
CREATE INDEX `ledger_tax_rules_idx` ON `ledger_tax_rules` (`tenant_id`,`market`,`effective_from`);--> statement-breakpoint
CREATE TABLE `ledger_txn_transitions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`txn_id` text NOT NULL,
	`from_state` text,
	`to_state` text NOT NULL,
	`actor_ref` text NOT NULL,
	`reason` text,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ledger_txn_transitions_idx` ON `ledger_txn_transitions` (`tenant_id`,`txn_id`,`ts`);--> statement-breakpoint
CREATE TABLE `ledger_txns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`type` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`correlation_id` text,
	`parent_txn_id` text,
	`reversal_of` text,
	`state` text DEFAULT 'initiated' NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`autonomy_level` text,
	`subject_refs_json` text,
	`currency` text NOT NULL,
	`base_currency` text NOT NULL,
	`fx_rate_ppm` integer,
	`amounts_json` text,
	`gross_minor` integer DEFAULT 0 NOT NULL,
	`base_gross_minor` integer DEFAULT 0 NOT NULL,
	`ledger_batch_id` text,
	`event_ids_json` text,
	`evidence_refs_json` text,
	`guardrails_json` text,
	`failure_code` text,
	`failure_detail` text,
	`external_timeout_at` integer,
	`metadata_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`settled_at` integer,
	`failed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_txns_idem_uq` ON `ledger_txns` (`tenant_id`,`type`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ledger_txns_tenant_idx` ON `ledger_txns` (`tenant_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `ledger_txns_corr_idx` ON `ledger_txns` (`tenant_id`,`correlation_id`);--> statement-breakpoint
CREATE INDEX `ledger_txns_type_idx` ON `ledger_txns` (`tenant_id`,`type`,`created_at`);--> statement-breakpoint
CREATE TABLE `ledger_usage_meters` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`subscription_id` text,
	`meter` text NOT NULL,
	`period` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`included_quantity` integer DEFAULT 0 NOT NULL,
	`unit_price_micro` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_usage_uq` ON `ledger_usage_meters` (`tenant_id`,`subscription_id`,`meter`,`period`);--> statement-breakpoint
CREATE TABLE `north_anomalies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`metric_key` text NOT NULL,
	`window` text NOT NULL,
	`magnitude` integer NOT NULL,
	`expected` integer,
	`actual` integer,
	`driver_analysis_json` text,
	`state` text DEFAULT 'new' NOT NULL,
	`linked_action_ref` text,
	`explained_by` text,
	`detected_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `north_anomalies_idx` ON `north_anomalies` (`tenant_id`,`state`,`detected_at`);--> statement-breakpoint
CREATE TABLE `north_boardpacks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`period` text NOT NULL,
	`title` text NOT NULL,
	`sections_json` text NOT NULL,
	`pdf_file_id` text,
	`xlsx_file_id` text,
	`distribution_log_json` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`approved_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `north_boardpacks_tenant_idx` ON `north_boardpacks` (`tenant_id`,`period`);--> statement-breakpoint
CREATE TABLE `north_briefings` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`date` text NOT NULL,
	`audience` text DEFAULT 'exec' NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`narrative_ref` text,
	`highlights_json` text,
	`anomalies_json` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`generated_by` text DEFAULT 'ai' NOT NULL,
	`ai_audit_id` text,
	`approved_by` text,
	`published_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `north_briefings_uq` ON `north_briefings` (`tenant_id`,`date`,`audience`,`locale`);--> statement-breakpoint
CREATE TABLE `north_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`title` text NOT NULL,
	`context_ref` text,
	`options_json` text,
	`chosen` text,
	`owner` text NOT NULL,
	`review_at` integer,
	`outcome_review_json` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `north_decisions_tenant_idx` ON `north_decisions` (`tenant_id`,`review_at`);--> statement-breakpoint
CREATE TABLE `north_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`name_json` text NOT NULL,
	`definition_sql_ref` text NOT NULL,
	`unit` text DEFAULT 'count' NOT NULL,
	`currency` text,
	`grain` text DEFAULT 'day' NOT NULL,
	`owner` text,
	`target_json` text,
	`sensitivity` text DEFAULT 'internal' NOT NULL,
	`direction` text DEFAULT 'up' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `north_metrics_key_uq` ON `north_metrics` (`tenant_id`,`key`);--> statement-breakpoint
CREATE TABLE `north_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`question` text NOT NULL,
	`assumptions_json` text NOT NULL,
	`model_run_ref` text,
	`result_json` text,
	`author` text NOT NULL,
	`shared_with_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `north_scenarios_tenant_idx` ON `north_scenarios` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `north_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`metric_key` text NOT NULL,
	`grain` text NOT NULL,
	`period` text NOT NULL,
	`dims_json` text,
	`dims_hash` text DEFAULT '' NOT NULL,
	`value` integer NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `north_snapshots_idx` ON `north_snapshots` (`tenant_id`,`metric_key`,`grain`,`period`);--> statement-breakpoint
CREATE UNIQUE INDEX `north_snapshots_uq` ON `north_snapshots` (`tenant_id`,`metric_key`,`grain`,`period`,`dims_hash`);--> statement-breakpoint
CREATE TABLE `orbit_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text,
	`channel` text NOT NULL,
	`external_ref` text,
	`do_id` text,
	`state` text DEFAULT 'bot' NOT NULL,
	`assignee_ref` text,
	`team_id` text,
	`csat` integer,
	`summary` text,
	`lang` text DEFAULT 'en' NOT NULL,
	`intent` text,
	`sentiment` integer,
	`first_response_ms` integer,
	`last_message_at` integer,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `orbit_conv_tenant_idx` ON `orbit_conversations` (`tenant_id`,`state`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `orbit_conv_customer_idx` ON `orbit_conversations` (`tenant_id`,`customer_id`);--> statement-breakpoint
CREATE INDEX `orbit_conv_assignee_idx` ON `orbit_conversations` (`tenant_id`,`assignee_ref`,`state`);--> statement-breakpoint
CREATE TABLE `orbit_handover_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`from_ref` text NOT NULL,
	`to_ref` text,
	`summary` text NOT NULL,
	`facts_json` text,
	`generated_by` text DEFAULT 'ai' NOT NULL,
	`accepted_by` text,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `orbit_handover_idx` ON `orbit_handover_notes` (`tenant_id`,`conversation_id`,`ts`);--> statement-breakpoint
CREATE TABLE `orbit_journey_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`journey_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`node` text NOT NULL,
	`state` text DEFAULT 'running' NOT NULL,
	`context_json` text,
	`next_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `orbit_journey_runs_due_idx` ON `orbit_journey_runs` (`tenant_id`,`state`,`next_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `orbit_journey_runs_uq` ON `orbit_journey_runs` (`tenant_id`,`journey_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `orbit_journeys` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`name_json` text NOT NULL,
	`graph_json` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orbit_journeys_uq` ON `orbit_journeys` (`tenant_id`,`key`,`version`);--> statement-breakpoint
CREATE TABLE `orbit_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`modality` text DEFAULT 'text' NOT NULL,
	`content` text NOT NULL,
	`attachments_json` text,
	`redactions_json` text,
	`ai_audit_id` text,
	`delivery_status` text,
	`external_ref` text,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `orbit_messages_conv_idx` ON `orbit_messages` (`tenant_id`,`conversation_id`,`ts`);--> statement-breakpoint
CREATE UNIQUE INDEX `orbit_messages_ext_uq` ON `orbit_messages` (`tenant_id`,`external_ref`);--> statement-breakpoint
CREATE TABLE `orbit_partner_txns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`partner_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_hash` text NOT NULL,
	`amount_minor` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`revshare_calc_minor` integer DEFAULT 0 NOT NULL,
	`settlement_batch` text,
	`txn_ref` text,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `orbit_partner_txns_idx` ON `orbit_partner_txns` (`tenant_id`,`partner_id`,`ts`);--> statement-breakpoint
CREATE INDEX `orbit_partner_txns_batch_idx` ON `orbit_partner_txns` (`tenant_id`,`settlement_batch`);--> statement-breakpoint
CREATE TABLE `orbit_partners` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`api_key_ref` text,
	`revshare_json` text,
	`sandbox_flag` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`contact_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `orbit_partners_tenant_idx` ON `orbit_partners` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `orbit_qa_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`rubric_key` text NOT NULL,
	`score` integer NOT NULL,
	`breakdown_json` text,
	`flags_json` text,
	`scored_by` text NOT NULL,
	`disputed_by` text,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `orbit_qa_idx` ON `orbit_qa_scores` (`tenant_id`,`conversation_id`,`ts`);--> statement-breakpoint
CREATE TABLE `orbit_renewals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`policy_ref` text NOT NULL,
	`customer_id` text NOT NULL,
	`expiry_at` integer NOT NULL,
	`churn_score` integer,
	`strategy` text DEFAULT 'human' NOT NULL,
	`requotes_json` text,
	`state` text DEFAULT 'scheduled' NOT NULL,
	`outcome_reason` text,
	`owner_ref` text,
	`offered_at` integer,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `orbit_renewals_tenant_idx` ON `orbit_renewals` (`tenant_id`,`state`,`expiry_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `orbit_renewals_policy_uq` ON `orbit_renewals` (`tenant_id`,`policy_ref`);--> statement-breakpoint
CREATE TABLE `scout_clusters` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`theme` text NOT NULL,
	`summary` text,
	`momentum_score` integer DEFAULT 0 NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`trail_json` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scout_clusters_tenant_idx` ON `scout_clusters` (`tenant_id`,`momentum_score`);--> statement-breakpoint
CREATE TABLE `scout_data_products` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`definition_json` text NOT NULL,
	`consent_basis` text NOT NULL,
	`aggregation_min` integer DEFAULT 50 NOT NULL,
	`subscribers_json` text,
	`delivery` text DEFAULT 'report' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scout_data_products_tenant_idx` ON `scout_data_products` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `scout_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`whitespace_id` text NOT NULL,
	`landing_ref` text,
	`traffic_plan_json` text,
	`results_json` text,
	`state` text DEFAULT 'draft' NOT NULL,
	`started_at` integer,
	`concluded_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scout_experiments_tenant_idx` ON `scout_experiments` (`tenant_id`,`state`);--> statement-breakpoint
CREATE TABLE `scout_panel_bench` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`line` text NOT NULL,
	`period` text NOT NULL,
	`our_price_idx` integer,
	`market_price_idx` integer,
	`win_rate` integer,
	`volume` integer DEFAULT 0 NOT NULL,
	`coverage_gaps_json` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scout_bench_tenant_idx` ON `scout_panel_bench` (`tenant_id`,`period`,`provider_id`);--> statement-breakpoint
CREATE TABLE `scout_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`source` text NOT NULL,
	`source_ref` text,
	`payload_json` text NOT NULL,
	`embedding_ref` text,
	`cluster_id` text,
	`weight` integer DEFAULT 1 NOT NULL,
	`observed_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scout_signals_tenant_idx` ON `scout_signals` (`tenant_id`,`source`,`observed_at`);--> statement-breakpoint
CREATE INDEX `scout_signals_cluster_idx` ON `scout_signals` (`tenant_id`,`cluster_id`);--> statement-breakpoint
CREATE TABLE `scout_whitespaces` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`description` text NOT NULL,
	`cluster_id` text,
	`evidence_refs_json` text,
	`demand_estimate` integer,
	`competition_score` integer,
	`status` text DEFAULT 'candidate' NOT NULL,
	`owner` text,
	`promoted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scout_whitespaces_tenant_idx` ON `scout_whitespaces` (`tenant_id`,`status`,`demand_estimate`);--> statement-breakpoint
CREATE TABLE `signal_aeo_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`query_cluster` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`content_ref` text NOT NULL,
	`citations_check_json` text,
	`freshness` integer,
	`cited_by_json` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `signal_aeo_tenant_idx` ON `signal_aeo_pages` (`tenant_id`,`query_cluster`,`locale`);--> statement-breakpoint
CREATE TABLE `signal_attribution_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text,
	`anon_id` text,
	`touch_type` text NOT NULL,
	`channel` text NOT NULL,
	`campaign_id` text,
	`creative_id` text,
	`value_minor` integer,
	`currency` text,
	`subject_ref` text,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `signal_attr_tenant_idx` ON `signal_attribution_events` (`tenant_id`,`ts`);--> statement-breakpoint
CREATE INDEX `signal_attr_customer_idx` ON `signal_attribution_events` (`tenant_id`,`customer_id`,`ts`);--> statement-breakpoint
CREATE INDEX `signal_attr_campaign_idx` ON `signal_attribution_events` (`tenant_id`,`campaign_id`,`ts`);--> statement-breakpoint
CREATE TABLE `signal_audiences` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`definition_json` text NOT NULL,
	`size_cached` integer,
	`refresh_policy` text DEFAULT 'daily' NOT NULL,
	`last_refreshed_at` integer,
	`consent_purposes` text DEFAULT 'marketing' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `signal_audiences_tenant_idx` ON `signal_audiences` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `signal_budget_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`from_ref` text NOT NULL,
	`to_ref` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`reason` text NOT NULL,
	`evidence_json` text,
	`approved_by` text NOT NULL,
	`reversed_by` text,
	`reversed_at` integer,
	`reversible_until` integer NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `signal_budget_moves_idx` ON `signal_budget_moves` (`tenant_id`,`ts`);--> statement-breakpoint
CREATE TABLE `signal_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`objective` text NOT NULL,
	`audience_id` text,
	`channels_json` text NOT NULL,
	`budget_json` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`guardrail_checks_json` text,
	`autonomy_level` text DEFAULT 'act_with_approval' NOT NULL,
	`start_at` integer,
	`end_at` integer,
	`owner_ref` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `signal_campaigns_tenant_idx` ON `signal_campaigns` (`tenant_id`,`state`,`start_at`);--> statement-breakpoint
CREATE INDEX `signal_campaigns_owner_idx` ON `signal_campaigns` (`tenant_id`,`owner_ref`);--> statement-breakpoint
CREATE TABLE `signal_creatives` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`campaign_id` text,
	`kind` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`content_ref` text NOT NULL,
	`variant_group` text,
	`compliance_status` text DEFAULT 'pending' NOT NULL,
	`compliance_notes_json` text,
	`performance_json` text,
	`generated_by` text DEFAULT 'human' NOT NULL,
	`ai_audit_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `signal_creatives_tenant_idx` ON `signal_creatives` (`tenant_id`,`campaign_id`,`locale`);--> statement-breakpoint
CREATE INDEX `signal_creatives_compliance_idx` ON `signal_creatives` (`tenant_id`,`compliance_status`);--> statement-breakpoint
CREATE TABLE `signal_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`campaign_id` text,
	`hypothesis` text NOT NULL,
	`variants_json` text NOT NULL,
	`metric` text NOT NULL,
	`min_sample` integer,
	`state` text DEFAULT 'draft' NOT NULL,
	`result_json` text,
	`concluded_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `signal_experiments_tenant_idx` ON `signal_experiments` (`tenant_id`,`state`);--> statement-breakpoint
CREATE TABLE `signal_spend` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`campaign_id` text,
	`channel` text NOT NULL,
	`day` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`conversions` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signal_spend_uq` ON `signal_spend` (`tenant_id`,`campaign_id`,`channel`,`day`);
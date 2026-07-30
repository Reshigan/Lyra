// Read models (docs/03 §Views). NORTH reads these + north_snapshots, never
// module hot tables. Every view carries tenant_id as its first column so the
// same withTenant() filter applies to a view as to a table.
//
// Views are created by a post-migration step (`applyViews`) rather than by
// drizzle-kit, which does not emit views for the sqlite dialect. They are
// CREATE-OR-REPLACE by drop+create, so they are safe to re-apply on every deploy.

/** Everything known about one customer, in one row. Powers ORBIT's context pane. */
const V_CUSTOMER_360 = `
CREATE VIEW v_customer_360 AS
SELECT
  c.tenant_id                                        AS tenant_id,
  c.id                                               AS customer_id,
  c.type                                             AS type,
  c.name_json                                        AS name_json,
  c.locale                                           AS locale,
  c.kyc_status                                       AS kyc_status,
  c.tags_json                                        AS tags_json,
  c.risk_flags_json                                  AS risk_flags_json,
  c.created_at                                       AS created_at,
  (SELECT COUNT(*) FROM axis_cases ac
     WHERE ac.tenant_id = c.tenant_id AND ac.customer_id = c.id
       AND ac.deleted_at IS NULL)                    AS case_count,
  (SELECT COUNT(*) FROM axis_policies ap
     WHERE ap.tenant_id = c.tenant_id AND ap.customer_id = c.id
       AND ap.status = 'active')                     AS active_policies,
  (SELECT COALESCE(SUM(ap.premium_minor), 0) FROM axis_policies ap
     WHERE ap.tenant_id = c.tenant_id AND ap.customer_id = c.id) AS premium_lifetime_minor,
  (SELECT COALESCE(SUM(ap.commission_minor), 0) FROM axis_policies ap
     WHERE ap.tenant_id = c.tenant_id AND ap.customer_id = c.id) AS commission_lifetime_minor,
  (SELECT MIN(ap.end_at) FROM axis_policies ap
     WHERE ap.tenant_id = c.tenant_id AND ap.customer_id = c.id
       AND ap.status = 'active')                     AS next_expiry_at,
  (SELECT COUNT(*) FROM orbit_conversations oc
     WHERE oc.tenant_id = c.tenant_id AND oc.customer_id = c.id) AS conversation_count,
  (SELECT MAX(oc.last_message_at) FROM orbit_conversations oc
     WHERE oc.tenant_id = c.tenant_id AND oc.customer_id = c.id) AS last_contact_at,
  (SELECT AVG(oc.csat) FROM orbit_conversations oc
     WHERE oc.tenant_id = c.tenant_id AND oc.customer_id = c.id
       AND oc.csat IS NOT NULL)                      AS csat_avg,
  (SELECT MAX(orr.churn_score) FROM orbit_renewals orr
     WHERE orr.tenant_id = c.tenant_id AND orr.customer_id = c.id
       AND orr.state = 'scheduled')                  AS churn_score,
  (SELECT COUNT(*) FROM axis_claims cl
     WHERE cl.tenant_id = c.tenant_id AND cl.customer_id = c.id) AS claim_count,
  (SELECT cs.purposes_json FROM core_consents cs
     WHERE cs.tenant_id = c.tenant_id AND cs.customer_id = c.id
     ORDER BY cs.ts DESC LIMIT 1)                    AS consent_purposes_json,
  (SELECT cs.channel_optins_json FROM core_consents cs
     WHERE cs.tenant_id = c.tenant_id AND cs.customer_id = c.id
     ORDER BY cs.ts DESC LIMIT 1)                    AS consent_channels_json
FROM core_customers c
WHERE c.deleted_at IS NULL
`;

/** Case throughput by status, line and day — the AXIS pipeline board and SLA view. */
const V_CASE_PIPELINE = `
CREATE VIEW v_case_pipeline AS
SELECT
  ac.tenant_id                                       AS tenant_id,
  DATE(ac.created_at / 1000, 'unixepoch')            AS day,
  ac.kind                                            AS kind,
  ac.product_line                                    AS product_line,
  ac.status                                          AS status,
  ac.team_id                                         AS team_id,
  ac.source                                          AS source,
  COUNT(*)                                           AS case_count,
  SUM(CASE WHEN ac.sla_due_at IS NOT NULL
            AND ac.closed_at IS NULL
            AND ac.sla_due_at < ac.updated_at THEN 1 ELSE 0 END) AS breached_count,
  SUM(CASE WHEN ac.status = 'issued' THEN 1 ELSE 0 END)          AS issued_count,
  SUM(CASE WHEN ac.status = 'failed' THEN 1 ELSE 0 END)          AS failed_count,
  COALESCE(SUM(ac.value_minor), 0)                   AS value_minor,
  AVG(CASE WHEN ac.closed_at IS NOT NULL
           THEN ac.closed_at - ac.created_at END)    AS avg_cycle_ms
FROM axis_cases ac
WHERE ac.deleted_at IS NULL
GROUP BY ac.tenant_id, day, ac.kind, ac.product_line, ac.status, ac.team_id, ac.source
`;

/** The renewal book: what expires, who owns it, how likely it walks. */
const V_RENEWAL_BOOK = `
CREATE VIEW v_renewal_book AS
SELECT
  r.tenant_id                                        AS tenant_id,
  r.id                                               AS renewal_id,
  r.customer_id                                      AS customer_id,
  r.policy_ref                                       AS policy_ref,
  r.expiry_at                                        AS expiry_at,
  DATE(r.expiry_at / 1000, 'unixepoch')              AS expiry_day,
  r.state                                            AS state,
  r.strategy                                         AS strategy,
  r.churn_score                                      AS churn_score,
  r.owner_ref                                        AS owner_ref,
  r.outcome_reason                                   AS outcome_reason,
  p.provider_id                                      AS provider_id,
  p.premium_minor                                    AS premium_minor,
  p.commission_minor                                 AS commission_minor,
  p.currency                                         AS currency,
  p.id                                               AS policy_id
FROM orbit_renewals r
LEFT JOIN axis_policies p
       ON p.tenant_id = r.tenant_id AND p.id = r.policy_ref
`;

/** Acquisition cost against realised value, per campaign and month. */
const V_CAC_LTV = `
CREATE VIEW v_cac_ltv AS
SELECT
  s.tenant_id                                        AS tenant_id,
  SUBSTR(s.day, 1, 7)                                AS month,
  s.campaign_id                                      AS campaign_id,
  s.channel                                          AS channel,
  SUM(s.amount_minor)                                AS spend_minor,
  SUM(s.clicks)                                      AS clicks,
  SUM(s.conversions)                                 AS conversions,
  (SELECT COUNT(*) FROM signal_attribution_events ae
     WHERE ae.tenant_id = s.tenant_id
       AND ae.campaign_id = s.campaign_id
       AND ae.touch_type = 'bind'
       AND SUBSTR(DATE(ae.ts / 1000, 'unixepoch'), 1, 7) = SUBSTR(s.day, 1, 7)) AS binds,
  (SELECT COALESCE(SUM(ae.value_minor), 0) FROM signal_attribution_events ae
     WHERE ae.tenant_id = s.tenant_id
       AND ae.campaign_id = s.campaign_id
       AND ae.touch_type = 'bind'
       AND SUBSTR(DATE(ae.ts / 1000, 'unixepoch'), 1, 7) = SUBSTR(s.day, 1, 7)) AS bound_value_minor
FROM signal_spend s
GROUP BY s.tenant_id, month, s.campaign_id, s.channel
`;

/** The 7am read (J-E1): one row per tenant per day, no module hot-table reads. */
const V_EXEC_DAILY = `
CREATE VIEW v_exec_daily AS
SELECT
  t.tenant_id                                        AS tenant_id,
  t.day                                              AS day,
  SUM(t.cases_created)                               AS cases_created,
  SUM(t.policies_issued)                             AS policies_issued,
  SUM(t.premium_minor)                               AS premium_minor,
  SUM(t.commission_minor)                            AS commission_minor,
  SUM(t.conversations)                               AS conversations,
  SUM(t.renewals_accepted)                           AS renewals_accepted,
  SUM(t.renewals_lost)                               AS renewals_lost,
  SUM(t.spend_minor)                                 AS spend_minor,
  SUM(t.ai_cost_micro)                               AS ai_cost_micro
FROM (
  SELECT tenant_id, DATE(created_at / 1000, 'unixepoch') AS day,
         COUNT(*) AS cases_created, 0 AS policies_issued, 0 AS premium_minor,
         0 AS commission_minor, 0 AS conversations, 0 AS renewals_accepted,
         0 AS renewals_lost, 0 AS spend_minor, 0 AS ai_cost_micro
    FROM axis_cases WHERE deleted_at IS NULL GROUP BY tenant_id, day
  UNION ALL
  SELECT tenant_id, DATE(created_at / 1000, 'unixepoch'),
         0, COUNT(*), COALESCE(SUM(premium_minor), 0), COALESCE(SUM(commission_minor), 0),
         0, 0, 0, 0, 0
    FROM axis_policies GROUP BY tenant_id, DATE(created_at / 1000, 'unixepoch')
  UNION ALL
  SELECT tenant_id, DATE(created_at / 1000, 'unixepoch'),
         0, 0, 0, 0, COUNT(*), 0, 0, 0, 0
    FROM orbit_conversations GROUP BY tenant_id, DATE(created_at / 1000, 'unixepoch')
  UNION ALL
  SELECT tenant_id, DATE(decided_at / 1000, 'unixepoch'),
         0, 0, 0, 0, 0,
         SUM(CASE WHEN state = 'accepted' THEN 1 ELSE 0 END),
         SUM(CASE WHEN state = 'lost' THEN 1 ELSE 0 END), 0, 0
    FROM orbit_renewals WHERE decided_at IS NOT NULL
   GROUP BY tenant_id, DATE(decided_at / 1000, 'unixepoch')
  UNION ALL
  SELECT tenant_id, day, 0, 0, 0, 0, 0, 0, 0, SUM(amount_minor), 0
    FROM signal_spend GROUP BY tenant_id, day
  UNION ALL
  SELECT tenant_id, DATE(ts / 1000, 'unixepoch'),
         0, 0, 0, 0, 0, 0, 0, 0, COALESCE(SUM(cost_micro), 0)
    FROM ai_audit_log GROUP BY tenant_id, DATE(ts / 1000, 'unixepoch')
) t
GROUP BY t.tenant_id, t.day
`;

export const VIEWS: Record<string, string> = {
  v_customer_360: V_CUSTOMER_360,
  v_case_pipeline: V_CASE_PIPELINE,
  v_renewal_book: V_RENEWAL_BOOK,
  v_cac_ltv: V_CAC_LTV,
  v_exec_daily: V_EXEC_DAILY
};

/** DROP + CREATE pairs, in order. Idempotent: safe on every deploy. */
export function viewSql(): string[] {
  return Object.entries(VIEWS).flatMap(([name, sql]) => [
    `DROP VIEW IF EXISTS ${name}`,
    sql.trim()
  ]);
}

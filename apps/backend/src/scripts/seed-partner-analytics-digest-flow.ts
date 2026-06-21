/**
 * Seed: Partner Storefront Analytics Digest — Weekly Flow (#581 S4)
 *
 * A weekly scheduled visual flow that computes a per-partner storefront
 * analytics digest (KPIs + breakdowns + rule-based suggestions) for every
 * active partner and emails it to each partner's active admins.
 *
 * Graph:
 *   schedule (weekly)
 *     → partner_analytics_digest   (S3 op — fans out over active partners,
 *                                    each digest computed by the S1 workflow)
 *     → bulk_trigger_workflow       → send-partner-digest-email (S2 workflow,
 *                                     once per digest, best-effort per partner)
 *     → log summary
 *
 * The op + workflow are referenced by STRING name only (no imports), so this
 * seed branches off main independently. It WON'T run end-to-end until the
 * stack #582 (S1) / #583 (S2) / #584 (S3) has merged and deployed — the op
 * type `partner_analytics_digest` and workflow `send-partner-digest-email`
 * must exist in the registry first. Seed it as `draft` and only flip to
 * `active` once those are live.
 *
 * Cadence (locked decision):
 *   Cron `30 3 * * 1` = 09:00 IST Monday when the container runs UTC.
 *   If the container runs in IST, change to `0 9 * * 1`. Confirm via `date`
 *   on the deployed host before activating. Period defaults to last_7_days,
 *   so a Monday run covers the previous calendar-ish week. The digest is
 *   compared against the equal-length window immediately before it (S1).
 *
 * Thresholds:
 *   The suggestion rules + their thresholds live in the S1 lib
 *   (`DEFAULT_DIGEST_THRESHOLDS` in src/workflows/analytics/partner-digest-lib.ts).
 *   Override per-run by adding a `thresholds` key to the digest op options
 *   below (partial overrides are merged onto the defaults). Sample-gated
 *   rules (referrer / page / mobile) only fire at >= 20 visitors.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-partner-analytics-digest-flow.ts
 *
 * Re-seed:
 *   Delete the existing flow first (admin UI or by id) and re-run. The
 *   script is idempotent and refuses to overwrite an existing flow.
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"

const FLOW_NAME = "Partner Storefront Analytics Digest — Weekly"

// Cron: 09:00 IST Monday assuming a UTC container (03:30 UTC).
const DIGEST_CRON = "30 3 * * 1"

// ─── Canvas positions ────────────────────────────────────────────────────────
const X_CENTER = 500
const Y_DIGEST = 140
const Y_DISPATCH = 280
const Y_LOG = 420

// ─── Flow definition (exported for the structural unit test) ───────────────────

export const FLOW_DEF = {
  name: FLOW_NAME,
  description:
    "Weekly scheduled digest: computes a per-partner storefront analytics " +
    "digest (KPIs + breakdowns + rule-based suggestions) for every active " +
    "partner, then bulk-triggers send-partner-digest-email once per digest. " +
    "Best-effort throughout — one un-provisioned partner cannot abort the run.",
  status: "draft" as const,
  trigger_type: "schedule" as const,
  trigger_config: {
    cron: DIGEST_CRON, // 09:00 IST Monday assuming UTC container
  },

  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.85 },
    nodes: [
      { id: "trigger",         type: "trigger",   position: { x: X_CENTER, y: -20 },        data: { label: "Schedule — 09:00 IST Monday", triggerType: "schedule", triggerConfig: { cron: DIGEST_CRON } } },
      { id: "compute_digests", type: "operation", position: { x: X_CENTER, y: Y_DIGEST },   data: { label: "Compute Partner Digests", operationKey: "compute_digests", operationType: "partner_analytics_digest", options: { period: "last_7_days", max_partners: 200, continue_on_error: true } } },
      { id: "send_digests",    type: "operation", position: { x: X_CENTER, y: Y_DISPATCH }, data: { label: "Send Digest Emails",      operationKey: "send_digests",    operationType: "bulk_trigger_workflow", options: { workflow_name: "send-partner-digest-email", items: "{{ compute_digests.digests }}", input_template: { digest: "{{ item }}" }, continue_on_error: true, max_items: 200 } } },
      { id: "log_summary",     type: "operation", position: { x: X_CENTER, y: Y_LOG },      data: { label: "Log Summary",            operationKey: "log_summary",     operationType: "log", options: { message: "Partner digest run — partners={{ compute_digests.count }} with_storefront={{ compute_digests.with_storefront }} with_suggestions={{ compute_digests.with_suggestions }} suggestions={{ compute_digests.suggestion_count }} failed_compute={{ compute_digests.failed }} emails_triggered={{ send_digests.triggered }} emails_failed={{ send_digests.failed }}", level: "info" } } },
    ],
    edges: [
      { id: "e-0", source: "trigger",         sourceHandle: "default", target: "compute_digests", targetHandle: "default" },
      { id: "e-1", source: "compute_digests", sourceHandle: "default", target: "send_digests",    targetHandle: "default" },
      { id: "e-2", source: "send_digests",    sourceHandle: "default", target: "log_summary",     targetHandle: "default" },
    ],
  },

  operations: [
    // ── 1. Compute a digest per active partner (S3 op wrapping S1) ──────────
    {
      operation_key: "compute_digests",
      operation_type: "partner_analytics_digest",
      name: "Compute Partner Digests",
      sort_order: 0,
      position_x: X_CENTER,
      position_y: Y_DIGEST,
      options: {
        // No partner_id / partner_ids → fans out over all status:active
        // partners (capped at max_partners). Period = weekly.
        period: "last_7_days",
        max_partners: 200,
        continue_on_error: true,
        // To tune the suggestion rules, add a partial threshold override:
        //   thresholds: { bounce_rate_high: 0.7, mobile_share_high: 0.6 },
      },
    },

    // ── 2. Email each digest (S2 workflow), once per partner ───────────────
    {
      operation_key: "send_digests",
      operation_type: "bulk_trigger_workflow",
      name: "Send Digest Emails",
      sort_order: 1,
      position_x: X_CENTER,
      position_y: Y_DISPATCH,
      options: {
        workflow_name: "send-partner-digest-email",
        // {{ compute_digests.digests }} → the array of per-partner digests.
        // Empty array short-circuits to triggered:0.
        items: "{{ compute_digests.digests }}",
        input_template: {
          // S2 accepts a pre-computed digest; partner_id is carried inside it.
          digest: "{{ item }}",
        },
        continue_on_error: true,
        // Match the op's max_partners so large weeks don't truncate sends.
        max_items: 200,
      },
    },

    // ── 3. Log summary line for observability ──────────────────────────────
    {
      operation_key: "log_summary",
      operation_type: "log",
      name: "Log Summary",
      sort_order: 2,
      position_x: X_CENTER,
      position_y: Y_LOG,
      options: {
        message:
          "Partner digest run — partners={{ compute_digests.count }} " +
          "with_storefront={{ compute_digests.with_storefront }} " +
          "with_suggestions={{ compute_digests.with_suggestions }} " +
          "suggestions={{ compute_digests.suggestion_count }} " +
          "failed_compute={{ compute_digests.failed }} " +
          "emails_triggered={{ send_digests.triggered }} " +
          "emails_failed={{ send_digests.failed }}",
        level: "info",
      },
    },
  ],

  connections: [
    { source_id: "trigger",         source_handle: "default", target_id: "compute_digests", connection_type: "default" as const },
    { source_id: "compute_digests", source_handle: "default", target_id: "send_digests",    connection_type: "default" as const },
    { source_id: "send_digests",    source_handle: "default", target_id: "log_summary",     connection_type: "default" as const },
  ],
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export default async function seedPartnerAnalyticsDigestFlow({
  container,
}: {
  container: any
}) {
  const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)

  const [existing] = await service.listVisualFlows({ name: FLOW_NAME } as any)
  if (existing) {
    console.log(`Flow "${FLOW_NAME}" already exists (${existing.id}) — skipping.`)
    console.log(`Delete it in the admin UI (or by id) to re-seed.`)
    return
  }

  console.log(`Creating flow "${FLOW_NAME}"...`)

  const flow = await service.createCompleteFlow({
    flow: {
      name: FLOW_DEF.name,
      description: FLOW_DEF.description,
      status: FLOW_DEF.status,
      trigger_type: FLOW_DEF.trigger_type,
      trigger_config: FLOW_DEF.trigger_config,
      // canvas_state holds the React Flow nodes/edges the editor renders.
      // Without it the editor opens to an empty canvas.
      canvas_state: FLOW_DEF.canvas_state,
    },
    operations: FLOW_DEF.operations,
    connections: FLOW_DEF.connections,
  })

  console.log(`\nFlow created: ${flow.id}`)
  console.log(`  Open: /app/visual-flows/${flow.id}\n`)
  console.log(`Before activating (draft → active):`)
  console.log(`  1. Ensure the #581 stack (S1 #582 / S2 #583 / S3 #584) is`)
  console.log(`     MERGED + DEPLOYED — the op "partner_analytics_digest" and`)
  console.log(`     workflow "send-partner-digest-email" must exist in the`)
  console.log(`     registry, else the run no-ops / errors.`)
  console.log(`  2. Author the "partner-storefront-digest" email_template row`)
  console.log(`     (active) and set MAILEROO_FROM_DOMAIN / PARTNER_DASHBOARD_URL`)
  console.log(`     / FRONTEND_URL (S2 ops tail).`)
  console.log(`  3. Confirm the deployed container's local time matches the cron`)
  console.log(`     assumption. This seed uses "${DIGEST_CRON}" = 09:00 IST Monday`)
  console.log(`     assuming UTC. If the container is in IST, edit to "0 9 * * 1".`)
  console.log(`  4. Flip flow status: draft → active in the admin editor.`)
}

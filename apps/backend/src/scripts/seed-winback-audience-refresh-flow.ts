/**
 * Seed: Winback Audience Refresh — Weekly Flow (#450/#916, visual-flow edition)
 *
 * Replaces the two MANUAL Data-Plumbing ops (that had to be run by hand with
 * dry_run=false to populate the winback audiences) with an OPERATOR-EDITABLE
 * scheduled visual flow. The schedule is parsed + fired every minute by
 * `src/jobs/run-scheduled-visual-flows.ts`; the operator owns the cadence from
 * the canvas — no redeploy to retime.
 *
 * Graph:
 *   schedule (weekly Mon, 0 2 * * 1)
 *     → run_maintenance_job  generate-newsletter-winback-targets  (apply)
 *     → run_maintenance_job  generate-winback-targets  (churn, apply)
 *     → log summary
 *
 * Both nodes use the generic `run_maintenance_job` op (ships in the same change)
 * which runs the registry job in-process (dry_run:false = apply). The jobs are
 * idempotent — an email already in the campaign is never re-queued — so a weekly
 * re-run only adds newly-qualifying contacts.
 *
 * Cadence (locked decision): "0 2 * * 1" = Mondays 02:00 UTC (≈ 07:30 IST).
 * Winback is a slow signal; weekly avoids re-scanning the same cooling contacts
 * too aggressively. Confirm host time before relying on the exact hour.
 *
 * Seeded ACTIVE (locked decision): the every-minute scanner picks it up and it
 * runs on the next matching tick. The jobs WRITE marketing_outreach rows.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-winback-audience-refresh-flow.ts
 *
 * Re-seed:
 *   Delete the existing flow first (admin UI or by id) and re-run. Idempotent —
 *   refuses to overwrite an existing flow.
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"

const FLOW_NAME = "Winback Audience Refresh — Weekly"

// Cron: Mondays 02:00 UTC ≈ 07:30 IST.
const WINBACK_CRON = "0 2 * * 1"

const NEWSLETTER_JOB = "generate-newsletter-winback-targets"
const CHURN_JOB = "generate-winback-targets"

// ─── Canvas positions ────────────────────────────────────────────────────────
const X_CENTER = 500
const Y_NEWSLETTER = 140
const Y_CHURN = 280
const Y_LOG = 420

// ─── Flow definition (exported for the structural unit test + install job) ─────

export const FLOW_DEF = {
  name: FLOW_NAME,
  description:
    "Weekly scheduled refresh of the winback audiences: run generate-newsletter-" +
    "winback-targets (cooling openers) then generate-winback-targets (churn-risk " +
    "≥70) via the run_maintenance_job op, then log. Both APPLY (dry_run:false) and " +
    "are idempotent — already-queued contacts are never re-created. Replaces the " +
    "two manual Data-Plumbing runs. Retime or disable from the canvas.",
  status: "active" as const,
  trigger_type: "schedule" as const,
  trigger_config: {
    cron: WINBACK_CRON, // Mondays 07:30 IST assuming a UTC container
  },

  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.9 },
    nodes: [
      { id: "trigger",        type: "trigger",   position: { x: X_CENTER, y: -20 },        data: { label: "Schedule — Mon 07:30 IST", triggerType: "schedule", triggerConfig: { cron: WINBACK_CRON } } },
      { id: "run_newsletter", type: "operation", position: { x: X_CENTER, y: Y_NEWSLETTER }, data: { label: "Newsletter winback targets", operationKey: "run_newsletter", operationType: "run_maintenance_job", options: { job_id: NEWSLETTER_JOB, dry_run: false } } },
      { id: "run_churn",      type: "operation", position: { x: X_CENTER, y: Y_CHURN },      data: { label: "Churn winback targets", operationKey: "run_churn", operationType: "run_maintenance_job", options: { job_id: CHURN_JOB, dry_run: false } } },
      { id: "log_summary",    type: "operation", position: { x: X_CENTER, y: Y_LOG },        data: { label: "Log Summary", operationKey: "log_summary", operationType: "log", options: { message: "Winback refresh — newsletter: {{ run_newsletter.summary }} | churn: {{ run_churn.summary }}", level: "info" } } },
    ],
    edges: [
      { id: "e-0", source: "trigger",        sourceHandle: "default", target: "run_newsletter", targetHandle: "default" },
      { id: "e-1", source: "run_newsletter", sourceHandle: "default", target: "run_churn",      targetHandle: "default" },
      { id: "e-2", source: "run_churn",      sourceHandle: "default", target: "log_summary",    targetHandle: "default" },
    ],
  },

  operations: [
    {
      operation_key: "run_newsletter",
      operation_type: "run_maintenance_job",
      name: "Newsletter winback targets",
      sort_order: 0,
      position_x: X_CENTER,
      position_y: Y_NEWSLETTER,
      options: { job_id: NEWSLETTER_JOB, dry_run: false },
    },
    {
      operation_key: "run_churn",
      operation_type: "run_maintenance_job",
      name: "Churn winback targets",
      sort_order: 1,
      position_x: X_CENTER,
      position_y: Y_CHURN,
      options: { job_id: CHURN_JOB, dry_run: false },
    },
    {
      operation_key: "log_summary",
      operation_type: "log",
      name: "Log Summary",
      sort_order: 2,
      position_x: X_CENTER,
      position_y: Y_LOG,
      options: {
        message:
          "Winback refresh — newsletter: {{ run_newsletter.summary }} | " +
          "churn: {{ run_churn.summary }}",
        level: "info",
      },
    },
  ],

  connections: [
    { source_id: "trigger",        source_handle: "default", target_id: "run_newsletter", connection_type: "default" as const },
    { source_id: "run_newsletter", source_handle: "default", target_id: "run_churn",      connection_type: "default" as const },
    { source_id: "run_churn",      source_handle: "default", target_id: "log_summary",    connection_type: "default" as const },
  ],
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export default async function seedWinbackAudienceRefreshFlow({
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
      canvas_state: FLOW_DEF.canvas_state,
    },
    operations: FLOW_DEF.operations,
    connections: FLOW_DEF.connections,
  })

  console.log(`\nFlow created: ${flow.id}`)
  console.log(`  Open: /app/visual-flows/${flow.id}\n`)
  console.log(`Seeded ACTIVE — the scheduler runs it on the next "${WINBACK_CRON}" tick.`)
  console.log(`Confirm the deployed container's local time matches the cron assumption`)
  console.log(`(this uses Mondays 02:00 UTC ≈ 07:30 IST); retime from the canvas if needed.`)
}

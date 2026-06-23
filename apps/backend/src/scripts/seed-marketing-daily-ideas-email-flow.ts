/**
 * Seed: Marketing Daily Ideas Email — Daily Flow (#659 slice 2, visual-flow edition)
 *
 * The daily AI-VP-of-Marketing tactical-ideas email, as an OPERATOR-EDITABLE
 * visual flow instead of a hard-coded `src/jobs/*` cron. The operator owns the
 * cadence from the canvas; the schedule is parsed + fired every minute by
 * `src/jobs/run-scheduled-visual-flows.ts`.
 *
 * Graph:
 *   schedule (daily, 30 1 * * *)
 *     → marketing_daily_ideas_email   (chains generate-ideas-email → guard →
 *                                       send-ideas-email; send gated, never throws)
 *     → log summary
 *
 * The op is referenced by STRING name only (no imports) so this seed branches
 * off main independently. The op type `marketing_daily_ideas_email` ships in the
 * same PR; the generate/send workflows are already on main.
 *
 * Cadence (locked decision):
 *   Cron `30 1 * * *` = 01:30 UTC ≈ 07:00 IST — 30 min AFTER
 *   `marketing-daily-refresh` ("0 1 * * *") so the ground-truth snapshot rows
 *   exist before we generate from them. If the deployed container runs in IST,
 *   re-time from the canvas (no redeploy). Confirm host time before activating.
 *
 * Operator safety (send is OFF by default):
 *   GENERATE always runs and persists a reviewable `marketing_ideas_log` row +
 *   guard verdict. SEND only fires when EITHER the env flag
 *   `MARKETING_IDEAS_EMAIL_ENABLED` is truthy OR the node option
 *   `send_enabled: true` is set on the canvas. Seeded with NEITHER → generate +
 *   log only until the operator explicitly opts in.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-marketing-daily-ideas-email-flow.ts
 *
 * Re-seed:
 *   Delete the existing flow first (admin UI or by id) and re-run. The script is
 *   idempotent and refuses to overwrite an existing flow.
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"

const FLOW_NAME = "Marketing Daily Ideas Email — Daily"

// Cron: 01:30 UTC ≈ 07:00 IST, 30 min after marketing-daily-refresh ("0 1 * * *").
const IDEAS_CRON = "30 1 * * *"

// ─── Canvas positions ────────────────────────────────────────────────────────
const X_CENTER = 500
const Y_RUN = 140
const Y_LOG = 280

// ─── Flow definition (exported for the structural unit test) ───────────────────

export const FLOW_DEF = {
  name: FLOW_NAME,
  description:
    "Daily scheduled AI tactical-ideas email: generate-ideas-email (LLM + " +
    "hallucination guard + persist marketing_ideas_log), then send-ideas-email " +
    "ONLY when guard-passed AND enabled. Send is OFF until the operator sets " +
    "MARKETING_IDEAS_EMAIL_ENABLED or the node's send_enabled option. " +
    "Never throws — a bad morning run cannot crash the executor.",
  status: "draft" as const,
  trigger_type: "schedule" as const,
  trigger_config: {
    cron: IDEAS_CRON, // 07:00 IST assuming a UTC container
  },

  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.9 },
    nodes: [
      { id: "trigger",     type: "trigger",   position: { x: X_CENTER, y: -20 },   data: { label: "Schedule — 07:00 IST daily", triggerType: "schedule", triggerConfig: { cron: IDEAS_CRON } } },
      { id: "run_ideas",   type: "operation", position: { x: X_CENTER, y: Y_RUN }, data: { label: "Generate + Send Ideas Email", operationKey: "run_ideas", operationType: "marketing_daily_ideas_email", options: {} } },
      { id: "log_summary", type: "operation", position: { x: X_CENTER, y: Y_LOG }, data: { label: "Log Summary", operationKey: "log_summary", operationType: "log", options: { message: "Daily ideas email — generated={{ run_ideas.generated }} guard_passed={{ run_ideas.guard_passed }} log_id={{ run_ideas.log_id }} send_enabled={{ run_ideas.send_enabled }} sent={{ run_ideas.sent }} skipped={{ run_ideas.skipped_reason }} errored={{ run_ideas.errored }}", level: "info" } } },
    ],
    edges: [
      { id: "e-0", source: "trigger",   sourceHandle: "default", target: "run_ideas",   targetHandle: "default" },
      { id: "e-1", source: "run_ideas", sourceHandle: "default", target: "log_summary", targetHandle: "default" },
    ],
  },

  operations: [
    // ── 1. Generate (always) → guarded Send (gated) ─────────────────────────
    {
      operation_key: "run_ideas",
      operation_type: "marketing_daily_ideas_email",
      name: "Generate + Send Ideas Email",
      sort_order: 0,
      position_x: X_CENTER,
      position_y: Y_RUN,
      options: {
        // No send_enabled here → the env flag MARKETING_IDEAS_EMAIL_ENABLED
        // decides (default OFF). To turn the email on from the canvas instead,
        // set send_enabled: true. Optional recipients override:
        //   recipients: ["ops@jyt.example"]
      },
    },

    // ── 2. Log summary line for observability ──────────────────────────────
    {
      operation_key: "log_summary",
      operation_type: "log",
      name: "Log Summary",
      sort_order: 1,
      position_x: X_CENTER,
      position_y: Y_LOG,
      options: {
        message:
          "Daily ideas email — generated={{ run_ideas.generated }} " +
          "guard_passed={{ run_ideas.guard_passed }} " +
          "log_id={{ run_ideas.log_id }} " +
          "send_enabled={{ run_ideas.send_enabled }} " +
          "sent={{ run_ideas.sent }} " +
          "skipped={{ run_ideas.skipped_reason }} " +
          "errored={{ run_ideas.errored }}",
        level: "info",
      },
    },
  ],

  connections: [
    { source_id: "trigger",   source_handle: "default", target_id: "run_ideas",   connection_type: "default" as const },
    { source_id: "run_ideas", source_handle: "default", target_id: "log_summary", connection_type: "default" as const },
  ],
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export default async function seedMarketingDailyIdeasEmailFlow({
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
  console.log(`Before activating (draft → active):`)
  console.log(`  1. The op "marketing_daily_ideas_email" ships in this PR (#659).`)
  console.log(`     The generate/send marketing workflows are already on main.`)
  console.log(`  2. Confirm the deployed container's local time matches the cron`)
  console.log(`     assumption. This seed uses "${IDEAS_CRON}" = 07:00 IST assuming`)
  console.log(`     a UTC container; re-time from the canvas if it runs in IST.`)
  console.log(`  3. SEND stays OFF until you opt in: set MARKETING_IDEAS_EMAIL_ENABLED`)
  console.log(`     (env) OR the node option send_enabled: true. Until then the flow`)
  console.log(`     only generates + logs a reviewable marketing_ideas_log row.`)
  console.log(`  4. Flip flow status: draft → active in the admin editor.`)
}

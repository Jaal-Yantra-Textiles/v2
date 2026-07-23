/**
 * Seed: Production Run Reminders — Scheduled Discoverer
 *
 * Daily-weekday scheduled visual flow that finds production runs which
 * are stuck in one of three buckets and emits a per-run reminder event.
 * The actual WhatsApp send is handled by the existing wildcard seed
 * (src/scripts/seed-partner-run-whatsapp-flow.ts) which already listens
 * to `production_run.*` and is "attuned to production subscription".
 *
 * Buckets (computed in the classify node):
 *   assignment_pending  status='sent_to_partner' AND no accepted_at
 *                       AND created_at  < now − 24h
 *   not_started         accepted_at set AND no started_at
 *                       AND accepted_at < now − 24h
 *   idle                status='in_progress' AND started_at < now − 72h
 *
 * Cadence:
 *   Cron `30 4 * * 1-5` = 10:00 IST Mon–Fri when the container runs UTC.
 *   If the container runs in IST, change to `0 10 * * 1-5`. Confirm via
 *   `date` on the deployed host before flipping the flow to active.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-production-run-reminders-flow.ts
 *
 * Re-seed:
 *   Delete the existing flow first (admin UI or by id) and re-run. The
 *   script is idempotent and refuses to overwrite.
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"

const FLOW_NAME = "Production Run Reminders — Daily Discoverer"

// ─── Canvas positions ────────────────────────────────────────────────────────
const X_CENTER = 500
const Y_READ = 140
const Y_CLASSIFY = 280
const Y_DISPATCH = 420
const Y_LOG = 560

// ─── Code for the classify node ──────────────────────────────────────────────
//
// Buckets the rows returned by read_active_runs into one of three
// reminder kinds. Drops rows missing partner_id or design_id so the
// downstream emit workflow never fires with incomplete payloads.
const CLASSIFY_CODE = `\
const records = ($input.read_active_runs && $input.read_active_runs.records) || []
const now = Date.now()
const ONE_DAY = 24 * 60 * 60 * 1000
const THREE_DAYS = 3 * ONE_DAY

function ageMs(iso) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return now - t
}

const items = []
const counts = { assignment_pending: 0, not_started: 0, idle: 0, skipped_no_partner: 0, skipped_not_overdue: 0 }

for (const run of records) {
  if (!run || !run.id) continue
  if (!run.partner_id) {
    counts.skipped_no_partner++
    continue
  }

  const status = run.status
  const createdAge = ageMs(run.created_at)
  const acceptedAge = ageMs(run.accepted_at)
  const startedAge = ageMs(run.started_at)

  let kind = null
  if (status === "sent_to_partner" && !run.accepted_at && createdAge !== null && createdAge >= ONE_DAY) {
    kind = "assignment_pending"
  } else if (run.accepted_at && !run.started_at && acceptedAge !== null && acceptedAge >= ONE_DAY) {
    kind = "not_started"
  } else if (status === "in_progress" && startedAge !== null && startedAge >= THREE_DAYS) {
    kind = "idle"
  }

  if (!kind) {
    counts.skipped_not_overdue++
    continue
  }

  counts[kind]++
  items.push({
    production_run_id: run.id,
    partner_id: run.partner_id,
    design_id: run.design_id || null,
    reminder_kind: kind,
  })
}

return { items, counts, total_inspected: records.length }
`

// ─── Flow definition ─────────────────────────────────────────────────────────

const FLOW_DEF = {
  name: FLOW_NAME,
  description:
    "Scheduled daily discoverer for stuck production runs. Reads active runs, " +
    "classifies them into reminder buckets (assignment_pending / not_started / idle) " +
    "and emits a per-run reminder event via the emit-production-run-reminder workflow. " +
    "The existing wildcard partner-WhatsApp flow picks up the events and sends the " +
    "appropriate Meta-approved template to the partner.",
  status: "draft" as const,
  trigger_type: "schedule" as const,
  trigger_config: {
    cron: "30 4 * * 1-5", // 10:00 IST Mon-Fri assuming UTC container
  },

  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.8 },
    nodes: [
      { id: "trigger",           type: "trigger",   position: { x: X_CENTER, y: -20 },        data: { label: "Schedule — 10:00 IST Mon-Fri", triggerType: "schedule", triggerConfig: { cron: "30 4 * * 1-5" } } },
      { id: "read_active_runs",  type: "operation", position: { x: X_CENTER, y: Y_READ },     data: { label: "Read Active Runs", operationKey: "read_active_runs", operationType: "read_data" } },
      { id: "classify",          type: "operation", position: { x: X_CENTER, y: Y_CLASSIFY }, data: { label: "Classify Buckets", operationKey: "classify",         operationType: "execute_code" } },
      { id: "dispatch",          type: "operation", position: { x: X_CENTER, y: Y_DISPATCH }, data: { label: "Dispatch Reminders", operationKey: "dispatch",       operationType: "bulk_trigger_workflow" } },
      { id: "log_summary",       type: "operation", position: { x: X_CENTER, y: Y_LOG },      data: { label: "Log Summary",      operationKey: "log_summary",      operationType: "log" } },
    ],
    edges: [
      { id: "e-0", source: "trigger",          sourceHandle: "default", target: "read_active_runs", targetHandle: "default" },
      { id: "e-1", source: "read_active_runs", sourceHandle: "default", target: "classify",         targetHandle: "default" },
      { id: "e-2", source: "classify",         sourceHandle: "default", target: "dispatch",         targetHandle: "default" },
      { id: "e-3", source: "dispatch",         sourceHandle: "default", target: "log_summary",      targetHandle: "default" },
    ],
  },

  operations: [
    // ── 1. Read active production runs ────────────────────────────────────
    {
      operation_key: "read_active_runs",
      operation_type: "read_data",
      name: "Read Active Runs",
      sort_order: 0,
      position_x: X_CENTER,
      position_y: Y_READ,
      options: {
        entity: "production_runs",
        fields: [
          "id",
          "partner_id",
          "design_id",
          "status",
          "accepted_at",
          "started_at",
          "finished_at",
          "created_at",
          "updated_at",
          "produced_quantity",
          "quantity",
        ],
        filters: {
          status: { $in: ["sent_to_partner", "in_progress"] },
        },
        limit: 500,
      },
    },

    // ── 2. Classify rows into reminder buckets ─────────────────────────────
    {
      operation_key: "classify",
      operation_type: "execute_code",
      name: "Classify Buckets",
      sort_order: 1,
      position_x: X_CENTER,
      position_y: Y_CLASSIFY,
      options: {
        code: CLASSIFY_CODE,
        timeout: 5000,
      },
    },

    // ── 3. Bulk-trigger the emit workflow once per stuck run ───────────────
    {
      operation_key: "dispatch",
      operation_type: "bulk_trigger_workflow",
      name: "Dispatch Reminders",
      sort_order: 2,
      position_x: X_CENTER,
      position_y: Y_DISPATCH,
      options: {
        workflow_name: "emit-production-run-reminder",
        // {{ classify.items }} is interpolated to the array returned by
        // the classify node. Empty array short-circuits to triggered:0.
        items: "{{ classify.items }}",
        input_template: {
          production_run_id: "{{ item.production_run_id }}",
          partner_id: "{{ item.partner_id }}",
          design_id: "{{ item.design_id }}",
          reminder_kind: "{{ item.reminder_kind }}",
        },
        continue_on_error: true,
        // Match the read_data limit so large reminder days don't truncate.
        max_items: 500,
      },
    },

    // ── 4. Log summary line for observability ──────────────────────────────
    {
      operation_key: "log_summary",
      operation_type: "log",
      name: "Log Summary",
      sort_order: 3,
      position_x: X_CENTER,
      position_y: Y_LOG,
      options: {
        message:
          "Reminder run — inspected={{ classify.total_inspected }} " +
          "assignment_pending={{ classify.counts.assignment_pending }} " +
          "not_started={{ classify.counts.not_started }} " +
          "idle={{ classify.counts.idle }} " +
          "dispatched={{ dispatch.triggered }} failed={{ dispatch.failed }}",
        level: "info",
      },
    },
  ],

  connections: [
    { source_id: "trigger",          source_handle: "default", target_id: "read_active_runs", connection_type: "default" as const },
    { source_id: "read_active_runs", source_handle: "default", target_id: "classify",         connection_type: "default" as const },
    { source_id: "classify",         source_handle: "default", target_id: "dispatch",         connection_type: "default" as const },
    { source_id: "dispatch",         source_handle: "default", target_id: "log_summary",      connection_type: "default" as const },
  ],
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export default async function seedProductionRunRemindersFlow({
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
      // Without this the editor opens to an empty canvas and the human has
      // to recreate every connection by hand (operations + connections rows
      // exist in their own tables but the editor reads canvas_state).
      canvas_state: FLOW_DEF.canvas_state,
    },
    operations: FLOW_DEF.operations,
    connections: FLOW_DEF.connections,
  })

  console.log(`\nFlow created: ${flow.id}`)
  console.log(`  Open: /app/visual-flows/${flow.id}\n`)
  console.log(`Before activating:`)
  console.log(`  1. Confirm the deployed container's local time matches your cron assumption.`)
  console.log(`     This seed assumes UTC ("30 4 * * 1-5" = 10:00 IST Mon-Fri).`)
  console.log(`     If the container is in IST, edit the flow to "0 10 * * 1-5".`)
  console.log(`  2. Ensure the wildcard dispatcher flow has the v3 reminder mappings +`)
  console.log(`     the gen_link→send URL-button wiring (#1093). Preferred: run the`)
  console.log(`     OPS Data-Plumbing job "Install / replace partner-run WhatsApp flow"`)
  console.log(`     (id sync-partner-run-whatsapp-flow) — replaces the live flow in place.`)
  console.log(`     Fallback: REPLACE_FLOW=1 npx medusa exec ./src/scripts/seed-partner-run-whatsapp-flow.ts`)
  console.log(`  3. Approve these 3 WhatsApp templates on every WABA you target`)
  console.log(`     (or run the OPS "Sync WhatsApp templates to Meta" job):`)
  console.log(`     - jyt_production_run_reminder_pending_v3      (URL action button)`)
  console.log(`     - jyt_production_run_reminder_not_started_v3  (URL action button)`)
  console.log(`     - jyt_production_run_reminder_idle_v3         (URL action button)`)
  console.log(`  4. Flip flow status: draft → active in the admin editor.`)
}

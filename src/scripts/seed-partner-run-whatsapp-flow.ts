/**
 * Seed: Partner WhatsApp — Production Run Notifications (single dispatcher)
 *
 * One active flow listens to all `production_run.*` events via wildcard
 * trigger (requires the subscriber upgrade in
 * src/subscribers/visual-flow-event-trigger.ts which accepts
 * `trigger_config.event_pattern`). The flow reads the run + partner,
 * maps the event to a Meta-approved template + variables, and sends via
 * the `send_whatsapp` operation.
 *
 * Templates mapped today (add more in the transform node as you approve
 * them in Meta):
 *   production_run.sent_to_partner → jyt_production_run_assigned
 *   production_run.cancelled       → jyt_production_run_cancelled
 *   production_run.completed       → jyt_production_run_completed (TODO approve)
 *
 * Other events still fire the flow but hit the "skip" branch — no send.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-partner-run-whatsapp-flow.ts
 *
 * Re-seed:
 *   Delete the existing flow first (admin UI or by id) and re-run. The
 *   script is idempotent and refuses to overwrite.
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"

const FLOW_NAME = "Partner WhatsApp — Production Run (all events)"

// ─── Canvas positions ────────────────────────────────────────────────────────
const X_CENTER = 500
const X_LEFT = 200
const X_RIGHT = 800

const Y_READ_RUN = 140
const Y_READ_PARTNER = 280
const Y_READ_DESIGN = 420
const Y_RESOLVE = 560
const Y_COND = 700
const Y_SEND = 840
const Y_SKIP = 840

// ─── Code for the resolve_template node ──────────────────────────────────────
//
// Returns the full send_whatsapp input payload so the downstream node can
// just interpolate from this one operation's output. Returns
// { skipped: true } when the event has no template — drives the condition.
const RESOLVE_TEMPLATE_CODE = `\
const eventName = $trigger?.event || ""
const expectedRunId = $trigger?.payload?.production_run_id || null
const expectedPartnerId = $trigger?.payload?.partner_id || null
const expectedDesignId = $trigger?.payload?.design_id || null

const run = $input.read_run?.records?.[0]
const partner = $input.read_partner?.records?.[0]
const design = $input.read_design?.records?.[0]

if (!expectedRunId) {
  return { skipped: true, reason: "missing_production_run_id_in_payload", event: eventName }
}
if (!expectedPartnerId) {
  // Parent / bundle run on a re-run dispatch — no partner attached. Skip.
  return { skipped: true, reason: "no_partner_on_event", event: eventName, run_id: expectedRunId }
}
if (!run || !partner) {
  return { skipped: true, reason: "missing_run_or_partner", event: eventName }
}
// Defensive: read_data drops null filter values silently and returns the
// first row when filters end up empty — verify identity so we never
// misdeliver to an unrelated partner.
if (run.id !== expectedRunId || partner.id !== expectedPartnerId) {
  return { skipped: true, reason: "id_mismatch", event: eventName, expectedRunId, expectedPartnerId, gotRunId: run?.id, gotPartnerId: partner?.id }
}

const partnerName = partner.name || "Partner"
const designName = design?.name || expectedDesignId || run?.design_id || "Unknown Design"
const quantity = String(run?.quantity ?? 0)
const runId = run?.id || expectedRunId

// Resolve recipient phone — verified whatsapp_number first, then first
// active admin's phone. Mirrors the legacy subscriber priority.
let phone = null
if (partner.whatsapp_number && partner.whatsapp_verified) {
  phone = partner.whatsapp_number
} else {
  const admins = partner.admins || []
  const activeAdmin = admins.find(a => a && a.is_active && a.phone)
  phone = activeAdmin?.phone || null
}

if (!phone) {
  return { skipped: true, reason: "no_phone", event: eventName, partner_id: partner.id }
}

// Extract cancellation / completion context from the event payload where available.
const notes = $trigger?.payload?.notes || run?.cancelled_reason || "No reason provided"
const producedQty = String($trigger?.payload?.produced_quantity ?? run?.produced_quantity ?? quantity)
const reason = $trigger?.payload?.reason || null

// Template map. Keep placeholder counts identical to the Meta template body.
// Canonical template names live in
// src/scripts/whatsapp-templates/partner-run-templates.ts and end in _v2 —
// they were re-approved in Meta with the button/ratio fixes. When you bump
// the spec to _v3, update these names to match after the new versions are
// APPROVED in all target WABAs.
const map = {
  "production_run.sent_to_partner": {
    template: "jyt_production_run_assigned_v3",
    vars: [partnerName, designName, quantity, runId],
  },
  "production_run.cancelled": {
    template: "jyt_production_run_cancelled_v3",
    vars: [partnerName, runId, designName, notes],
  },
  "production_run.completed": {
    template: "jyt_production_run_completed_v3",
    vars: [partnerName, runId, designName, producedQty],
  },
  // Add more mappings here as templates get approved in Meta.
  // "production_run.accepted":  { template: "…", vars: [...] },
  // "production_run.started":   { template: "…", vars: [...] },
  // "production_run.finished":  { template: "…", vars: [...] },
}

const config = map[eventName]
if (!config) {
  return { skipped: true, reason: "no_template_for_event", event: eventName }
}

return {
  skipped: false,
  event: eventName,
  to: phone,
  partner_id: partner.id,
  template_name: config.template,
  variables: config.vars,
  context_type: "production_run",
  context_id: runId,
}
`

// ─── Flow definition ─────────────────────────────────────────────────────────

const FLOW_DEF = {
  name: FLOW_NAME,
  description:
    "Single dispatcher for partner-facing WhatsApp notifications on every " +
    "production_run event. Uses event_pattern to listen to production_run.*, " +
    "maps the event to a Meta-approved template via an execute_code node, " +
    "then dispatches through the send_whatsapp operation (multi-number routing, " +
    "partner validation, dedup, audit persistence all included).",
  status: "draft" as const,
  trigger_type: "event" as const,
  trigger_config: {
    // Wildcard — requires src/subscribers/visual-flow-event-trigger.ts
    // with the event_pattern support. Falls back gracefully otherwise.
    event_pattern: "production_run.*",
  },

  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.7 },
    nodes: [
      { id: "trigger", type: "trigger", position: { x: X_CENTER, y: -20 }, data: { label: "Production Run — any event", triggerType: "event", triggerConfig: { event_pattern: "production_run.*" } } },
      { id: "read_run",         type: "operation", position: { x: X_CENTER, y: Y_READ_RUN },     data: { label: "Read Production Run", operationKey: "read_run",         operationType: "read_data"    } },
      { id: "read_partner",     type: "operation", position: { x: X_CENTER, y: Y_READ_PARTNER }, data: { label: "Read Partner",        operationKey: "read_partner",     operationType: "read_data"    } },
      { id: "read_design",      type: "operation", position: { x: X_CENTER, y: Y_READ_DESIGN },  data: { label: "Read Design",         operationKey: "read_design",      operationType: "read_data"    } },
      { id: "resolve_template", type: "operation", position: { x: X_CENTER, y: Y_RESOLVE },      data: { label: "Resolve Template",    operationKey: "resolve_template", operationType: "execute_code" } },
      { id: "has_template",     type: "operation", position: { x: X_CENTER, y: Y_COND },         data: { label: "Has Template?",       operationKey: "has_template",     operationType: "condition"    } },
      { id: "send",             type: "operation", position: { x: X_LEFT,   y: Y_SEND },         data: { label: "Send WhatsApp",       operationKey: "send",             operationType: "send_whatsapp" } },
      { id: "log_skip",         type: "operation", position: { x: X_RIGHT,  y: Y_SKIP },         data: { label: "Log: Skipped",        operationKey: "log_skip",         operationType: "log"          } },
    ],
    edges: [
      { id: "e-0", source: "trigger",          sourceHandle: "default", target: "read_run",         targetHandle: "default" },
      { id: "e-1", source: "read_run",         sourceHandle: "default", target: "read_partner",     targetHandle: "default" },
      { id: "e-2", source: "read_partner",     sourceHandle: "default", target: "read_design",      targetHandle: "default" },
      { id: "e-3", source: "read_design",      sourceHandle: "default", target: "resolve_template", targetHandle: "default" },
      { id: "e-4", source: "resolve_template", sourceHandle: "default", target: "has_template",     targetHandle: "default" },
      { id: "e-5", source: "has_template",     sourceHandle: "success", target: "send",             targetHandle: "default" },
      { id: "e-6", source: "has_template",     sourceHandle: "failure", target: "log_skip",         targetHandle: "default" },
    ],
  },

  operations: [
    // ── 1. Read production run ────────────────────────────────────────────
    {
      operation_key: "read_run",
      operation_type: "read_data",
      name: "Read Production Run",
      sort_order: 0,
      position_x: X_CENTER,
      position_y: Y_READ_RUN,
      options: {
        entity: "production_runs",
        fields: [
          "id",
          "partner_id",
          "design_id",
          "quantity",
          "produced_quantity",
          "run_type",
          "status",
          "cancelled_reason",
        ],
        filters: { id: "{{ $trigger.payload.production_run_id }}" },
        limit: 1,
      },
    },

    // ── 2. Read partner ───────────────────────────────────────────────────
    {
      operation_key: "read_partner",
      operation_type: "read_data",
      name: "Read Partner",
      sort_order: 1,
      position_x: X_CENTER,
      position_y: Y_READ_PARTNER,
      options: {
        entity: "partner",
        fields: [
          "id",
          "name",
          "whatsapp_number",
          "whatsapp_verified",
          "admins.id",
          "admins.first_name",
          "admins.last_name",
          "admins.phone",
          "admins.is_active",
        ],
        filters: { id: "{{ $trigger.payload.partner_id }}" },
        limit: 1,
      },
    },

    // ── 3. Read design (no module link to production_runs — must read by id) ──
    {
      operation_key: "read_design",
      operation_type: "read_data",
      name: "Read Design",
      sort_order: 2,
      position_x: X_CENTER,
      position_y: Y_READ_DESIGN,
      options: {
        entity: "design",
        fields: ["id", "name"],
        filters: { id: "{{ $trigger.payload.design_id }}" },
        limit: 1,
      },
    },

    // ── 4. Resolve template config ─────────────────────────────────────────
    {
      operation_key: "resolve_template",
      operation_type: "execute_code",
      name: "Resolve Template",
      sort_order: 3,
      position_x: X_CENTER,
      position_y: Y_RESOLVE,
      options: {
        code: RESOLVE_TEMPLATE_CODE,
        timeout: 5000,
      },
    },

    // ── 5. Condition: was a template resolved? ────────────────────────────
    {
      operation_key: "has_template",
      operation_type: "condition",
      name: "Has Template?",
      sort_order: 4,
      position_x: X_CENTER,
      position_y: Y_COND,
      options: {
        condition_mode: "expression",
        // Skipped === true → failure branch (log only). false → success branch (send).
        expression: "resolve_template.skipped === false",
        filter_rule: { "resolve_template.skipped": { _eq: false } },
      },
    },

    // ── 6a. Send WhatsApp template (success branch) ────────────────────────
    {
      operation_key: "send",
      operation_type: "send_whatsapp",
      name: "Send WhatsApp",
      sort_order: 5,
      position_x: X_LEFT,
      position_y: Y_SEND,
      options: {
        // Full-variable syntax resolves to the actual value (not stringified)
        // when the entire option is a single {{ … }} expression.
        to: "{{ resolve_template.to }}",
        partner_id: "{{ resolve_template.partner_id }}",
        mode: "template",
        template_name: "{{ resolve_template.template_name }}",
        variables: "{{ resolve_template.variables }}",
        context_type: "{{ resolve_template.context_type }}",
        context_id: "{{ resolve_template.context_id }}",
        // Standard 60-minute dedup on (context_type, context_id) — blocks
        // double-send when an event retries.
        dedup_window_minutes: 60,
        // Production notifications should never leak to unknown recipients.
        require_partner: true,
      },
    },

    // ── 6b. Log skip (failure branch) ──────────────────────────────────────
    {
      operation_key: "log_skip",
      operation_type: "log",
      name: "Log: Skipped",
      sort_order: 6,
      position_x: X_RIGHT,
      position_y: Y_SKIP,
      options: {
        message:
          "Skipping WhatsApp for event {{ $trigger.event }} — reason: {{ resolve_template.reason }}",
        level: "info",
      },
    },
  ],

  connections: [
    { source_id: "trigger",          source_handle: "default", target_id: "read_run",         connection_type: "default" as const },
    { source_id: "read_run",         source_handle: "default", target_id: "read_partner",     connection_type: "default" as const },
    { source_id: "read_partner",     source_handle: "default", target_id: "read_design",      connection_type: "default" as const },
    { source_id: "read_design",      source_handle: "default", target_id: "resolve_template", connection_type: "default" as const },
    { source_id: "resolve_template", source_handle: "default", target_id: "has_template",     connection_type: "default" as const },
    { source_id: "has_template",     source_handle: "success", target_id: "send",             connection_type: "success" as const },
    { source_id: "has_template",     source_handle: "failure", target_id: "log_skip",         connection_type: "failure" as const },
  ],
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export default async function seedPartnerRunWhatsAppFlow({
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
    },
    operations: FLOW_DEF.operations,
    connections: FLOW_DEF.connections,
  })

  console.log(`\nFlow created: ${flow.id}`)
  console.log(`  Open: /app/visual-flows/${flow.id}\n`)
  console.log(`Before activating:`)
  console.log(`  1. Ensure these 3 templates are APPROVED on every WABA you target:`)
  console.log(`     - jyt_production_run_assigned_v3  (with buttons)`)
  console.log(`     - jyt_production_run_cancelled_v3`)
  console.log(`     - jyt_production_run_completed_v3`)
  console.log(`     Check status via the admin Templates panel or:`)
  console.log(`       MODE=dry-run npx medusa exec ./src/scripts/manage-whatsapp-templates.ts`)
  console.log(`  2. Disable the legacy subscriber to avoid double-sends:`)
  console.log(`     Set env DISABLE_LEGACY_WHATSAPP_PARTNER_SUBSCRIBER=1`)
  console.log(`     (or delete src/subscribers/whatsapp-partner-notifications.ts)`)
  console.log(`  3. Flip flow status: draft → active in the admin editor.`)
}

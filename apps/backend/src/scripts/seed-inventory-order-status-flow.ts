/**
 * Seed: Partner WhatsApp — Inventory Order Status (single dispatcher) [#771]
 *
 * One active flow listens to the `inventory_orders.inventory-order.status-changed`
 * event emitted by `updateInventoryOrderStep` (#776) — which fires ONLY on a
 * real status transition (previous → new), unlike the noisy generic
 * `inventory_orders.inventory-orders.updated` that also fires on metadata-only
 * writes. The flow reads the order + its assigned partner, maps the new status
 * to a Meta-approved template + variables, and sends via `send_whatsapp`.
 *
 * Status → notification mapping (defined inline in the resolve_message node):
 *   Processing → "In Production"        ┐
 *   Shipped    → "Shipped"              │  all use the single generic template
 *   Partial    → "Partially Delivered"  │  jyt_inventory_order_status_v1 with
 *   Delivered  → "Delivered"            │  vars [partnerName, orderId, statusLabel]
 *   Cancelled  → "Cancelled"            ┘
 *   Pending    → (skipped — initial state, no partner-facing ping)
 *
 * Orders with no assigned partner / no reachable phone hit the "skip" branch —
 * no send (admin-only inventory orders never have a partner recipient).
 *
 * Why one generic template instead of one per status: WhatsApp templates need
 * Meta approval per WABA. A single parameterized "your order {id} is now
 * {status}" template keeps the operator's approval burden at ONE template; the
 * canvas can later be branched into per-status templates or an email arm.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-inventory-order-status-flow.ts
 *
 * Or, no shell: Settings → Data Plumbing → "Install inventory-order status
 * visual flow" (the install-inventory-order-status-flow maintenance job seeds
 * this same FLOW_DEF — single source of truth).
 *
 * Re-seed:
 *   Delete the existing flow (admin UI or by id) and re-run. The script is
 *   idempotent — it refuses to overwrite an existing flow with the same name.
 *
 * Before activating in admin:
 *   1. Ensure this template is APPROVED on every WABA you target:
 *        - jyt_inventory_order_status_v1   (body refs {{1}} {{2}} {{3}})
 *      Push it via:
 *        npx medusa exec ./src/scripts/manage-whatsapp-templates.ts
 *   2. Flip flow status: draft → active in the admin editor.
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"

const FLOW_NAME = "Partner WhatsApp — Inventory Order Status"

// The #776 status-changed event — fires only on a real transition.
const STATUS_CHANGED_EVENT =
  "inventory_orders.inventory-order.status-changed"

// Single Meta-approved template covering every notified status.
const STATUS_TEMPLATE = "jyt_inventory_order_status_v1"

// ─── Canvas positions ────────────────────────────────────────────────────────
const X_CENTER = 500
const X_LEFT = 200
const X_RIGHT = 800

const Y_READ_ORDER = 140
const Y_RESOLVE = 300
const Y_COND = 460
const Y_SEND = 620
const Y_SKIP = 620

// ─── Code for the resolve_message node ───────────────────────────────────────
//
// Returns the full send_whatsapp input payload so the downstream node can
// interpolate from this one operation's output. Returns { skipped: true } with
// a reason when the transition has no notification — drives the has_message
// condition below.
//
// Variables produced (positional, identical order across languages):
//   [partnerName, orderId, statusLabel]
//
// Recipient resolution mirrors the partner payment-status flow: first ACTIVE
// admin's first_name + phone for a real greeting, falling back to
// partner.whatsapp_number. Language is the admin's preferred_language when set,
// else send_whatsapp's own chain (conv metadata → phone heuristic → env → hi).
const RESOLVE_MESSAGE_CODE = `\
const eventName = $trigger?.event || ""
const orderId = $trigger?.payload?.id || null
const previousStatus = $trigger?.payload?.previous_status || null
const newStatus = $trigger?.payload?.status || null

if (!orderId) {
  return { skipped: true, reason: "missing_order_id_in_payload", event: eventName }
}
if (!newStatus) {
  return { skipped: true, reason: "missing_status_in_payload", event: eventName, order_id: orderId }
}

const order = $input.read_order?.records?.[0]
if (!order) {
  return { skipped: true, reason: "order_not_found", event: eventName, order_id: orderId }
}

// The order ↔ partner link accessor is singular (\`order.partner\`), but defend
// against an array shape just in case the query returns a list.
const partner = Array.isArray(order.partner) ? order.partner[0] : order.partner
if (!partner) {
  return { skipped: true, reason: "no_partner_on_order", event: eventName, order_id: orderId }
}

// Status → human label. Only these statuses notify the partner. Pending (the
// initial state) and any unmapped/future status fall through to skip.
const labels = {
  "Processing": "In Production",
  "Shipped": "Shipped",
  "Partial": "Partially Delivered",
  "Delivered": "Delivered",
  "Cancelled": "Cancelled",
}
const statusLabel = labels[newStatus]
if (!statusLabel) {
  return { skipped: true, reason: "status_not_notified", event: eventName, order_id: orderId, status: newStatus }
}

// Pick the first active admin for greeting + phone routing.
const admins = Array.isArray(partner.admins) ? partner.admins : []
const activeAdmins = admins.filter(function (a) { return a && a.is_active !== false })
const primary = activeAdmins[0] || admins[0] || null

const partnerName = (primary && primary.first_name)
  ? primary.first_name
  : (partner.name || "Partner")

const phone = (primary && primary.phone) ? primary.phone : (partner.whatsapp_number || null)
if (!phone) {
  return { skipped: true, reason: "no_phone_on_partner", event: eventName, order_id: orderId, partner_id: partner.id }
}

const languageCode = (primary && primary.preferred_language) ? primary.preferred_language : ""

return {
  skipped: false,
  event: eventName,
  to: phone,
  partner_id: partner.id,
  template_name: "${STATUS_TEMPLATE}",
  variables: [partnerName, orderId, statusLabel],
  language_code: languageCode || "",
  status: newStatus,
  status_label: statusLabel,
  previous_status: previousStatus,
  context_type: "inventory_order",
  // context_id is per (order, status) so each distinct transition delivers once
  // (Processing → Shipped → Delivered each send), while an event RETRY within
  // the dedup window collapses to a single send. Stable across retries because
  // both order id and the new status are deterministic for one transition.
  context_id: orderId + ":" + newStatus,
  order_id: orderId,
}
`

// ─── Flow definition (exported for the structural unit test + the job) ─────────

export const FLOW_DEF = {
  name: FLOW_NAME,
  description:
    "Single dispatcher for partner-facing WhatsApp notifications on every " +
    "inventory-order status transition. Listens to " +
    "inventory_orders.inventory-order.status-changed (fires only on a real " +
    "status delta, #776), reads the order + assigned partner, maps the new " +
    "status to a label via an execute_code node, then dispatches the generic " +
    "jyt_inventory_order_status_v1 template through send_whatsapp. Notifies on " +
    "Processing / Shipped / Partial / Delivered / Cancelled; skips Pending and " +
    "partner-less orders.",
  status: "draft" as const,
  trigger_type: "event" as const,
  trigger_config: {
    event_types: [STATUS_CHANGED_EVENT],
  },

  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.8 },
    nodes: [
      { id: "trigger",         type: "trigger",   position: { x: X_CENTER, y: -20 },          data: { label: "Inventory Order — status changed", triggerType: "event", triggerConfig: { event_types: [STATUS_CHANGED_EVENT] } } },
      { id: "read_order",      type: "operation", position: { x: X_CENTER, y: Y_READ_ORDER }, data: { label: "Read Order + Partner", operationKey: "read_order",      operationType: "read_data"     } },
      { id: "resolve_message", type: "operation", position: { x: X_CENTER, y: Y_RESOLVE },    data: { label: "Resolve Message",      operationKey: "resolve_message", operationType: "execute_code"  } },
      { id: "has_message",     type: "operation", position: { x: X_CENTER, y: Y_COND },       data: { label: "Has Message?",         operationKey: "has_message",     operationType: "condition"     } },
      { id: "send",            type: "operation", position: { x: X_LEFT,   y: Y_SEND },       data: { label: "Send WhatsApp",        operationKey: "send",            operationType: "send_whatsapp" } },
      { id: "log_skip",        type: "operation", position: { x: X_RIGHT,  y: Y_SKIP },       data: { label: "Log: Skipped",         operationKey: "log_skip",        operationType: "log"           } },
    ],
    edges: [
      { id: "e-0", source: "trigger",         sourceHandle: "default", target: "read_order",      targetHandle: "default" },
      { id: "e-1", source: "read_order",      sourceHandle: "default", target: "resolve_message", targetHandle: "default" },
      { id: "e-2", source: "resolve_message", sourceHandle: "default", target: "has_message",     targetHandle: "default" },
      { id: "e-3", source: "has_message",     sourceHandle: "success", target: "send",            targetHandle: "default" },
      { id: "e-4", source: "has_message",     sourceHandle: "failure", target: "log_skip",        targetHandle: "default" },
    ],
  },

  operations: [
    // ── 1. Read inventory order + assigned partner (+ admins) ──────────────
    {
      operation_key: "read_order",
      operation_type: "read_data",
      name: "Read Order + Partner",
      sort_order: 0,
      position_x: X_CENTER,
      position_y: Y_READ_ORDER,
      options: {
        entity: "inventory_orders",
        fields: [
          "id",
          "status",
          "quantity",
          "partner.id",
          "partner.name",
          "partner.whatsapp_number",
          "partner.admins.id",
          "partner.admins.first_name",
          "partner.admins.phone",
          "partner.admins.is_active",
          "partner.admins.preferred_language",
        ],
        filters: { id: "{{ $trigger.payload.id }}" },
        limit: 1,
      },
    },

    // ── 2. Resolve message config from the status transition ───────────────
    {
      operation_key: "resolve_message",
      operation_type: "execute_code",
      name: "Resolve Message",
      sort_order: 1,
      position_x: X_CENTER,
      position_y: Y_RESOLVE,
      options: {
        code: RESOLVE_MESSAGE_CODE,
        timeout: 5000,
      },
    },

    // ── 3. Condition: did we resolve a sendable message? ───────────────────
    {
      operation_key: "has_message",
      operation_type: "condition",
      name: "Has Message?",
      sort_order: 2,
      position_x: X_CENTER,
      position_y: Y_COND,
      options: {
        condition_mode: "expression",
        // skipped === false → success branch (send). true → failure (log only).
        expression: "resolve_message.skipped === false",
        filter_rule: { "resolve_message.skipped": { _eq: false } },
      },
    },

    // ── 4a. Send WhatsApp template (success branch) ────────────────────────
    {
      operation_key: "send",
      operation_type: "send_whatsapp",
      name: "Send WhatsApp",
      sort_order: 3,
      position_x: X_LEFT,
      position_y: Y_SEND,
      options: {
        to: "{{ resolve_message.to }}",
        partner_id: "{{ resolve_message.partner_id }}",
        mode: "template",
        template_name: "{{ resolve_message.template_name }}",
        variables: "{{ resolve_message.variables }}",
        language_code: "{{ resolve_message.language_code }}",
        context_type: "{{ resolve_message.context_type }}",
        context_id: "{{ resolve_message.context_id }}",
        // 60-min dedup blocks accidental double-sends from event retries.
        // Distinct transitions carry distinct context_ids (order:status) so
        // legitimate progression (Processing → Shipped → Delivered) all deliver.
        dedup_window_minutes: 60,
        require_partner: true,
      },
    },

    // ── 4b. Log skip (failure branch) ──────────────────────────────────────
    {
      operation_key: "log_skip",
      operation_type: "log",
      name: "Log: Skipped",
      sort_order: 4,
      position_x: X_RIGHT,
      position_y: Y_SKIP,
      options: {
        message:
          "Skipping inventory-order WhatsApp for {{ $trigger.payload.id }} " +
          "(status {{ $trigger.payload.status }}) — reason: {{ resolve_message.reason }}",
        level: "info",
      },
    },
  ],

  connections: [
    { source_id: "trigger",         source_handle: "default", target_id: "read_order",      connection_type: "default" as const },
    { source_id: "read_order",      source_handle: "default", target_id: "resolve_message", connection_type: "default" as const },
    { source_id: "resolve_message", source_handle: "default", target_id: "has_message",     connection_type: "default" as const },
    { source_id: "has_message",     source_handle: "success", target_id: "send",            connection_type: "success" as const },
    { source_id: "has_message",     source_handle: "failure", target_id: "log_skip",        connection_type: "failure" as const },
  ],
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export default async function seedInventoryOrderStatusFlow({
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
  console.log(`Before activating:`)
  console.log(`  1. Ensure this template is APPROVED on every WABA you target:`)
  console.log(`     - ${STATUS_TEMPLATE}   (body uses {{1}} partner, {{2}} order id, {{3}} status)`)
  console.log(`     Push via:`)
  console.log(`       npx medusa exec ./src/scripts/manage-whatsapp-templates.ts`)
  console.log(`  2. Flip flow status: draft → active in the admin editor.`)
}

/**
 * Seed: Partner WhatsApp — Inventory Shipment Pickup (single dispatcher) [#888 S3]
 *
 * One active flow listens to the
 * `inventory_orders.inventory-shipment.status-changed` event — fired only on a
 * real shipment status transition, either by the carrier tracking webhook
 * (sync-inventory-shipment-tracking.ts, forward-only guarded) or at shipment
 * creation when a pickup was scheduled (create-inventory-order-shipment.ts).
 * The flow reads the shipment's order + assigned partner, maps the milestone
 * to the Meta-approved pickup template + variables, and sends via
 * `send_whatsapp`.
 *
 * Shipment status → notification mapping (inline in resolve_message):
 *   pickup_scheduled → "Pickup scheduled for <date>"  ┐ both use the single
 *   picked_up        → "Picked up by the courier"     ┘ jyt_inventory_shipment_pickup_v1
 *                        with vars [partnerName, orderId, awb, milestoneLabel]
 *   in_transit / out_for_delivery / delivered / rto / cancelled → (skipped —
 *     order-level Shipped/Delivered already notify via the #771 flow; transit
 *     scans are noise; RTO/cancel are operator conversations, not templates)
 *
 * Orders with no assigned partner / no reachable phone hit the "skip" branch —
 * no send (admin-only inventory orders never have a partner recipient).
 *
 * Why one generic template: WhatsApp templates need Meta approval per WABA. A
 * single parameterized "pickup update … {milestone}" template keeps the
 * operator's approval burden at ONE template for both pickup milestones.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-inventory-shipment-pickup-flow.ts
 *
 * Or, no shell: Settings → Data Plumbing → "Install inventory-shipment pickup
 * visual flow" (the install-inventory-shipment-pickup-flow maintenance job
 * seeds this same FLOW_DEF — single source of truth).
 *
 * Re-seed:
 *   Delete the existing flow (admin UI or by id) and re-run. The script is
 *   idempotent — it refuses to overwrite an existing flow with the same name.
 *
 * Before activating in admin:
 *   1. Ensure this template is APPROVED on every WABA you target:
 *        - jyt_inventory_shipment_pickup_v1   (body refs {{1}}–{{4}})
 *      Push it via the sync-whatsapp-templates Data Plumbing job, or:
 *        npx medusa exec ./src/scripts/manage-whatsapp-templates.ts
 *   2. Flip flow status: draft → active in the admin editor.
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"

const FLOW_NAME = "Partner WhatsApp — Inventory Shipment Pickup"

// The #888 shipment-level status-changed event — fires only on a real transition.
const STATUS_CHANGED_EVENT =
  "inventory_orders.inventory-shipment.status-changed"

// Single Meta-approved template covering both pickup milestones.
const PICKUP_TEMPLATE = "jyt_inventory_shipment_pickup_v1"

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
// The trigger payload here is SHIPMENT-shaped (sync-inventory-shipment-tracking
// / create-inventory-order-shipment emit): { id: shipment_id, awb, carrier,
// previous_status, status, order_id, pickup_scheduled_date }. read_order
// filters on payload.order_id — NOT payload.id (that's the shipment).
//
// Variables produced (positional, identical order across languages):
//   [partnerName, orderId, awb, milestoneLabel]
const RESOLVE_MESSAGE_CODE = `\
const eventName = $trigger?.event || ""
const shipmentId = $trigger?.payload?.id || null
const orderId = $trigger?.payload?.order_id || null
const newStatus = $trigger?.payload?.status || null
const awb = $trigger?.payload?.awb || null
const pickupDate = $trigger?.payload?.pickup_scheduled_date || null

if (!shipmentId) {
  return { skipped: true, reason: "missing_shipment_id_in_payload", event: eventName }
}
if (!orderId) {
  return { skipped: true, reason: "missing_order_id_in_payload", event: eventName, shipment_id: shipmentId }
}
if (!newStatus) {
  return { skipped: true, reason: "missing_status_in_payload", event: eventName, shipment_id: shipmentId }
}

// Milestone → human label. Only the pickup milestones notify the partner —
// order-level Shipped/Delivered already go out via the #771 status flow, and
// transit scans are noise. Unmapped/future statuses fall through to skip.
let milestoneLabel = null
if (newStatus === "pickup_scheduled") {
  milestoneLabel = pickupDate
    ? "Pickup scheduled for " + pickupDate
    : "Pickup scheduled"
} else if (newStatus === "picked_up") {
  milestoneLabel = "Picked up by the courier"
}
if (!milestoneLabel) {
  return { skipped: true, reason: "status_not_notified", event: eventName, shipment_id: shipmentId, status: newStatus }
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
  template_name: "${PICKUP_TEMPLATE}",
  variables: [partnerName, orderId, awb || "-", milestoneLabel],
  language_code: languageCode || "",
  status: newStatus,
  milestone_label: milestoneLabel,
  context_type: "inventory_shipment",
  // context_id is per (shipment, status) so each distinct milestone delivers
  // once (pickup_scheduled then picked_up each send), while an event RETRY
  // within the dedup window collapses to a single send.
  context_id: shipmentId + ":" + newStatus,
  shipment_id: shipmentId,
  order_id: orderId,
}
`

// ─── Flow definition (exported for the structural unit test + the job) ─────────

export const FLOW_DEF = {
  name: FLOW_NAME,
  description:
    "Single dispatcher for partner-facing WhatsApp pickup notifications on " +
    "inventory-shipment status transitions. Listens to " +
    "inventory_orders.inventory-shipment.status-changed (#888 — fired by the " +
    "carrier tracking webhook and at shipment creation when a pickup is " +
    "scheduled), reads the shipment's order + assigned partner, maps the " +
    "milestone via an execute_code node, then dispatches the generic " +
    "jyt_inventory_shipment_pickup_v1 template through send_whatsapp. Notifies " +
    "on pickup_scheduled / picked_up; skips transit noise, order-level " +
    "milestones (covered by the #771 status flow) and partner-less orders.",
  status: "draft" as const,
  trigger_type: "event" as const,
  trigger_config: {
    event_types: [STATUS_CHANGED_EVENT],
  },

  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.8 },
    nodes: [
      { id: "trigger",         type: "trigger",   position: { x: X_CENTER, y: -20 },          data: { label: "Inventory Shipment — status changed", triggerType: "event", triggerConfig: { event_types: [STATUS_CHANGED_EVENT] } } },
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
    // ── 1. Read the shipment's inventory order + assigned partner ──────────
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
        // The event payload is shipment-shaped: order_id carries the order.
        filters: { id: "{{ $trigger.payload.order_id }}" },
        limit: 1,
      },
    },

    // ── 2. Resolve message config from the shipment milestone ──────────────
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
        // Distinct milestones carry distinct context_ids (shipment:status) so
        // pickup_scheduled → picked_up both deliver.
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
          "Skipping inventory-shipment pickup WhatsApp for {{ $trigger.payload.id }} " +
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

export default async function seedInventoryShipmentPickupFlow({
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
  console.log(`     - ${PICKUP_TEMPLATE}   ({{1}} partner, {{2}} order id, {{3}} awb, {{4}} milestone)`)
  console.log(`     Push via the sync-whatsapp-templates Data Plumbing job, or:`)
  console.log(`       npx medusa exec ./src/scripts/manage-whatsapp-templates.ts`)
  console.log(`  2. Flip flow status: draft → active in the admin editor.`)
}

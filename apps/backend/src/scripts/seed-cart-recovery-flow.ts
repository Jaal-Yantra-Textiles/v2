/**
 * Seed: Cart Recovery — Hourly Discoverer
 *
 * Hourly scheduled visual flow that finds abandoned storefront carts and
 * sends a recovery email via the existing `send-notification-email`
 * workflow with the pre-seeded `cart-abandoned` template
 * (see scripts/seed-email-templates.ts).
 *
 * Flow (5 nodes):
 *   1. read_carts        Cart Module read — completed_at null, items present,
 *                        email captured, idle window 1h–7d
 *   2. classify          Filter out carts already reminded (metadata
 *                        recovery_email_sent_at), build send + update payloads
 *   3. dispatch          bulk_trigger_workflow → send-notification-email
 *   4. mark_sent         bulk_update_data → set metadata.recovery_email_sent_at
 *   5. log_summary       observability line
 *
 * Cadence:
 *   Cron `0 * * * *` = top of every hour. The flow is created in `draft`
 *   status; flip to `active` from the admin editor after verifying the
 *   STORE_URL constant below matches the deployed storefront and the
 *   `cart-abandoned` template is approved on the active email provider.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-cart-recovery-flow.ts
 *
 * Re-seed:
 *   Delete the existing flow first (admin UI or by id) and re-run. The
 *   script is idempotent and refuses to overwrite.
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"

const FLOW_NAME = "Cart Recovery — Hourly Discoverer"

// Storefront URL embedded as a flow constant. Edit the seeded operations'
// `options.code` if the deployed storefront moves. We avoid relying on
// process.env at flow-execution time because the execute_code sandbox does
// not expose it consistently across runners.
const STORE_URL = process.env.STORE_URL || "https://cicilabel.com"

// Idle thresholds expressed as hours so the classify code stays readable.
// FLOOR is the minimum age of `updated_at` for a cart to be eligible.
// CEILING caps the age to avoid waking dead carts from months ago when the
// flow is first switched on.
const IDLE_FLOOR_HOURS = 1
const IDLE_CEILING_HOURS = 24 * 7 // 7 days

// ─── Canvas positions ────────────────────────────────────────────────────────
const X_CENTER = 500
const Y_READ = 140
const Y_CLASSIFY = 280
const Y_DISPATCH = 420
const Y_MARK = 560
const Y_LOG = 700

// ─── execute_code body for the classify node ────────────────────────────────
//
// Splits the read_carts result into:
//   - send_items   payloads for `send-notification-email` workflow
//   - update_items selectors+data for bulk_update_data to flip the
//                  metadata.recovery_email_sent_at flag
// Drops carts that:
//   - already have metadata.recovery_email_sent_at set
//   - lack email AND have no linked customer.email
//   - are older than the ceiling (avoids waking dormant carts)
const CLASSIFY_CODE = `\
const records = ($input.read_carts && $input.read_carts.records) || []
const now = Date.now()
const FLOOR_MS = ${IDLE_FLOOR_HOURS} * 60 * 60 * 1000
const CEIL_MS  = ${IDLE_CEILING_HOURS} * 60 * 60 * 1000
const STORE_URL = "${STORE_URL}"

const send_items = []
const update_items = []
const counts = {
  total: records.length,
  already_reminded: 0,
  no_email: 0,
  no_items: 0,
  too_old: 0,
  too_fresh: 0,
  converted: 0,
  queued: 0,
}

for (const cart of records) {
  if (!cart || !cart.id) continue

  const md = cart.metadata || {}
  if (md.recovery_email_sent_at) {
    counts.already_reminded++
    continue
  }
  // A cart converted to a real order (admin Design Order → Convert path stamps
  // converted_order_id) must never get a recovery email — the customer already
  // purchased. The convert flow now also sets completed_at, but guard on the
  // marker too for carts converted before that fix / via other paths. #443.
  if (md.converted_order_id) {
    counts.converted = (counts.converted || 0) + 1
    continue
  }

  const items = Array.isArray(cart.items) ? cart.items : []
  if (items.length === 0) {
    counts.no_items++
    continue
  }

  const email = cart.email || (cart.customer && cart.customer.email) || null
  if (!email) {
    counts.no_email++
    continue
  }

  const updatedTs = cart.updated_at ? new Date(cart.updated_at).getTime() : null
  const ageMs = updatedTs ? now - updatedTs : null
  if (ageMs === null || !Number.isFinite(ageMs)) {
    counts.too_fresh++
    continue
  }
  if (ageMs < FLOOR_MS) {
    counts.too_fresh++
    continue
  }
  if (ageMs > CEIL_MS) {
    counts.too_old++
    continue
  }

  const firstName =
    (cart.customer && cart.customer.first_name) ||
    (cart.shipping_address && cart.shipping_address.first_name) ||
    "there"

  send_items.push({
    cart_id: cart.id,
    to: email,
    template: "cart-abandoned",
    data: {
      customer_first_name: firstName,
      cart_url: STORE_URL + "/checkout/cart/" + cart.id,
      current_year: String(new Date().getFullYear()),
      unsubscribe_url: STORE_URL + "/unsubscribe?cart_id=" + cart.id,
    },
  })

  update_items.push({
    selector: { id: cart.id },
    data: {
      metadata: {
        ...md,
        recovery_email_sent_at: new Date(now).toISOString(),
      },
    },
  })

  counts.queued++
}

return { send_items, update_items, counts }
`

// ─── Flow definition ─────────────────────────────────────────────────────────

const FLOW_DEF = {
  name: FLOW_NAME,
  description:
    "Hourly discoverer for abandoned storefront carts. Reads non-completed " +
    "carts that are between " +
    IDLE_FLOOR_HOURS +
    "h and " +
    IDLE_CEILING_HOURS / 24 +
    "d idle, filters out already-reminded ones, and sends the `cart-abandoned` " +
    "template via the send-notification-email workflow. Marks each cart with " +
    "metadata.recovery_email_sent_at to prevent re-sends on the next tick.",
  status: "draft" as const,
  trigger_type: "schedule" as const,
  trigger_config: {
    cron: "0 * * * *", // top of every hour
  },

  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.8 },
    nodes: [
      { id: "trigger",     type: "trigger",   position: { x: X_CENTER, y: -20 },        data: { label: "Schedule — hourly", triggerType: "schedule", triggerConfig: { cron: "0 * * * *" } } },
      { id: "read_carts",  type: "operation", position: { x: X_CENTER, y: Y_READ },     data: { label: "Read Abandoned Carts", operationKey: "read_carts", operationType: "read_data" } },
      { id: "classify",    type: "operation", position: { x: X_CENTER, y: Y_CLASSIFY }, data: { label: "Build Recovery Payloads", operationKey: "classify", operationType: "execute_code" } },
      { id: "dispatch",    type: "operation", position: { x: X_CENTER, y: Y_DISPATCH }, data: { label: "Send Recovery Emails", operationKey: "dispatch", operationType: "bulk_trigger_workflow" } },
      { id: "mark_sent",   type: "operation", position: { x: X_CENTER, y: Y_MARK },     data: { label: "Mark Carts As Reminded", operationKey: "mark_sent", operationType: "bulk_update_data" } },
      { id: "log_summary", type: "operation", position: { x: X_CENTER, y: Y_LOG },      data: { label: "Log Summary", operationKey: "log_summary", operationType: "log" } },
    ],
    edges: [
      { id: "e-0", source: "trigger",    sourceHandle: "default", target: "read_carts",  targetHandle: "default" },
      { id: "e-1", source: "read_carts", sourceHandle: "default", target: "classify",    targetHandle: "default" },
      { id: "e-2", source: "classify",   sourceHandle: "default", target: "dispatch",    targetHandle: "default" },
      { id: "e-3", source: "dispatch",   sourceHandle: "default", target: "mark_sent",   targetHandle: "default" },
      { id: "e-4", source: "mark_sent",  sourceHandle: "default", target: "log_summary", targetHandle: "default" },
    ],
  },

  operations: [
    // ── 1. Read carts that look abandoned ─────────────────────────────────
    //
    // We can't push the metadata.recovery_email_sent_at de-dup into the
    // read filter (JSON-field operators are flaky across drivers) — that
    // happens in the classify node below. The DB filter is "non-completed
    // cart with at least one item, an email, and idle within the window".
    {
      operation_key: "read_carts",
      operation_type: "read_data",
      name: "Read Abandoned Carts",
      sort_order: 0,
      position_x: X_CENTER,
      position_y: Y_READ,
      options: {
        entity: "cart",
        fields: [
          "id",
          "email",
          "customer_id",
          "currency_code",
          "completed_at",
          "created_at",
          "updated_at",
          "metadata",
          "items.id",
          "items.title",
          "items.quantity",
          "items.unit_price",
          "shipping_address.first_name",
          "customer.id",
          "customer.email",
          "customer.first_name",
        ],
        filters: {
          completed_at: null,
          $and: [
            { items: { id: { $ne: null } } },
            { $or: [{ email: { $ne: null } }, { customer_id: { $ne: null } }] },
          ],
        },
        // The classify node enforces the idle floor/ceiling on `updated_at`.
        // We over-fetch slightly so the in-code filter has a real population
        // to work against — 500 covers most stores without straining memory.
        limit: 500,
      },
    },

    // ── 2. Classify rows + build send/update payloads ─────────────────────
    {
      operation_key: "classify",
      operation_type: "execute_code",
      name: "Build Recovery Payloads",
      sort_order: 1,
      position_x: X_CENTER,
      position_y: Y_CLASSIFY,
      options: {
        code: CLASSIFY_CODE,
        timeout: 5000,
      },
    },

    // ── 3. Bulk-trigger send-notification-email per cart ──────────────────
    {
      operation_key: "dispatch",
      operation_type: "bulk_trigger_workflow",
      name: "Send Recovery Emails",
      sort_order: 2,
      position_x: X_CENTER,
      position_y: Y_DISPATCH,
      options: {
        workflow_name: "send-notification-email",
        items: "{{ classify.send_items }}",
        input_template: {
          to: "{{ item.to }}",
          template: "{{ item.template }}",
          data: "{{ item.data }}",
        },
        continue_on_error: true,
        max_items: 500,
      },
    },

    // ── 4. Mark each cart so the next tick skips it ───────────────────────
    {
      operation_key: "mark_sent",
      operation_type: "bulk_update_data",
      name: "Mark Carts As Reminded",
      sort_order: 3,
      position_x: X_CENTER,
      position_y: Y_MARK,
      options: {
        module: "cart",
        collection: "carts",
        items: "{{ classify.update_items }}",
        continue_on_error: true,
        max_items: 500,
      },
    },

    // ── 5. Summary line for observability ─────────────────────────────────
    {
      operation_key: "log_summary",
      operation_type: "log",
      name: "Log Summary",
      sort_order: 4,
      position_x: X_CENTER,
      position_y: Y_LOG,
      options: {
        message:
          "Cart recovery — total={{ classify.counts.total }} " +
          "queued={{ classify.counts.queued }} " +
          "already_reminded={{ classify.counts.already_reminded }} " +
          "no_email={{ classify.counts.no_email }} " +
          "no_items={{ classify.counts.no_items }} " +
          "too_fresh={{ classify.counts.too_fresh }} " +
          "too_old={{ classify.counts.too_old }} " +
          "converted={{ classify.counts.converted }} " +
          "sent={{ dispatch.triggered }} failed={{ dispatch.failed }} " +
          "marked={{ mark_sent.updated }}",
        level: "info",
      },
    },
  ],

  connections: [
    { source_id: "trigger",    source_handle: "default", target_id: "read_carts",  connection_type: "default" as const },
    { source_id: "read_carts", source_handle: "default", target_id: "classify",    connection_type: "default" as const },
    { source_id: "classify",   source_handle: "default", target_id: "dispatch",    connection_type: "default" as const },
    { source_id: "dispatch",   source_handle: "default", target_id: "mark_sent",   connection_type: "default" as const },
    { source_id: "mark_sent",  source_handle: "default", target_id: "log_summary", connection_type: "default" as const },
  ],
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export default async function seedCartRecoveryFlow({
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
  console.log(`  1. Confirm STORE_URL in the seed matches the deployed storefront`)
  console.log(`     (currently embedded as "${STORE_URL}").`)
  console.log(`  2. Confirm the "cart-abandoned" email template is seeded and active`)
  console.log(`     (./src/scripts/seed-email-templates.ts).`)
  console.log(`  3. Confirm the active notification provider can send transactional`)
  console.log(`     email — the flow uses the send-notification-email workflow.`)
  console.log(`  4. Optionally adjust the cron from "0 * * * *" (hourly) to match`)
  console.log(`     your cadence and the floor/ceiling idle hours in the classify code.`)
  console.log(`  5. Flip flow status: draft → active in the admin editor.`)
}

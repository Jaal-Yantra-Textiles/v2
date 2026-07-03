/**
 * Seed: Artisan Product Review — Email (single dispatcher)
 *
 * #859 S2 (#861). One active flow listens to the two artisan review-outcome
 * events emitted by the admin approve/reject routes:
 *
 *   partner_product.approved → email template `artisan-product-approved`
 *   partner_product.rejected → email template `artisan-product-rejected`
 *                              (carries the reviewer's reason + a re-submit CTA)
 *
 * The flow reads the product + owning partner, resolves the artisan's admin
 * email + greeting, maps the event to a template via an execute_code node, then
 * sends through the `send_email` operation. Anything without a mapped template
 * or a resolvable email hits the skip branch — no send.
 *
 * This is the operator-editable seam the artisan lifecycle emails run through:
 * the events are also registered in visual-flow-event-trigger.ts, so the copy,
 * recipient logic and branching can be tuned on the canvas without a deploy.
 *
 * Install:
 *   npx medusa exec ./src/scripts/seed-artisan-product-approval-flow.ts
 *   # or Admin → Settings → Data Plumbing → "Install artisan product review email flow"
 *
 * Before activating:
 *   1. Seed the two email templates (Data Plumbing "Seed email templates", or
 *      npx medusa exec ./src/scripts/seed-partner-email-templates.ts).
 *   2. Flip flow status draft → active in the admin editor.
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"

const FLOW_NAME = "Artisan Product Review — Email"

// ─── Canvas positions ────────────────────────────────────────────────────────
const X_CENTER = 500
const X_LEFT = 200
const X_RIGHT = 800

const Y_READ_PRODUCT = 140
const Y_READ_PARTNER = 280
const Y_RESOLVE = 420
const Y_COND = 560
const Y_SEND = 700

// ─── Code for the resolve_email node ─────────────────────────────────────────
//
// Builds the send_email payload from the event + reads. Returns
// { skipped: true, reason } when there's no template for the event or no
// resolvable artisan email — which drives the has_email condition below.
const RESOLVE_EMAIL_CODE = `\
const eventName = $trigger?.event || ""
const productId = $trigger?.payload?.id || null
const partnerId = $trigger?.payload?.partner_id || null

const product = $input.read_product?.records?.[0]
const partner = $input.read_partner?.records?.[0]

if (!productId || !partnerId) {
  return { skipped: true, reason: "missing_ids_in_payload", event: eventName }
}
if (!partner) {
  return { skipped: true, reason: "partner_not_found", event: eventName, partner_id: partnerId }
}

// Recipient: the first active partner admin's email (that's where partner
// emails live — partner-admin.email, not on the partner row).
const admins = Array.isArray(partner.admins) ? partner.admins : []
const activeAdmins = admins.filter(function (a) { return a && a.is_active !== false })
const primary = activeAdmins[0] || admins[0] || null
const email = primary && primary.email ? primary.email : null
if (!email) {
  return { skipped: true, reason: "no_admin_email", event: eventName, partner_id: partnerId }
}

const partnerName = (primary && primary.first_name) ? primary.first_name : (partner.name || "there")
const productTitle = (product && product.title) ? product.title : "your product"
const productHandle = product && product.handle ? product.handle : ""

// Base URLs as literals — the execute_code sandbox exposes $trigger/$input but
// NOT $env. Tune these on the canvas if the storefront/partner host changes.
const storeUrl = "https://cicilabel.com"
const partnerAppUrl = "https://partner.jaalyantra.com"
const trimTrail = function (s) { return String(s).replace(/\\/+$/, "") }
const productUrl = productHandle ? (trimTrail(storeUrl) + "/products/" + productHandle) : storeUrl
const resubmitUrl = trimTrail(partnerAppUrl) + "/products"

const map = {
  "partner_product.approved": {
    template: "artisan-product-approved",
    subject: "🎉 Your product is approved — " + productTitle,
  },
  "partner_product.rejected": {
    template: "artisan-product-rejected",
    subject: "Changes needed on your product — " + productTitle,
  },
}
const cfg = map[eventName]
if (!cfg) {
  return { skipped: true, reason: "no_template_for_event", event: eventName }
}

const reason = ($trigger?.payload?.rejection_reason) || ""
const year = String(new Date().getFullYear())

return {
  skipped: false,
  event: eventName,
  to: email,
  subject: cfg.subject,
  template: cfg.template,
  partner_name: partnerName,
  product_title: productTitle,
  product_url: productUrl,
  reason: reason,
  resubmit_url: resubmitUrl,
  store_url: storeUrl,
  current_year: year,
}
`

// ─── Flow definition ─────────────────────────────────────────────────────────

export const FLOW_DEF = {
  name: FLOW_NAME,
  description:
    "Single dispatcher for the artisan product review emails. Listens to " +
    "partner_product.approved and partner_product.rejected, reads the product " +
    "+ owning partner, resolves the artisan's admin email, maps the event to an " +
    "email template (approved / needs-changes with reason + re-submit CTA) via " +
    "an execute_code node, then dispatches through the send_email operation.",
  status: "draft" as const,
  trigger_type: "event" as const,
  trigger_config: {
    event_types: ["partner_product.approved", "partner_product.rejected"],
  },

  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.8 },
    nodes: [
      { id: "trigger", type: "trigger", position: { x: X_CENTER, y: -20 }, data: { label: "Artisan product approved / rejected", triggerType: "event", triggerConfig: { event_types: ["partner_product.approved", "partner_product.rejected"] } } },
      { id: "read_product", type: "operation", position: { x: X_CENTER, y: Y_READ_PRODUCT }, data: { label: "Read Product",  operationKey: "read_product",  operationType: "read_data"    } },
      { id: "read_partner", type: "operation", position: { x: X_CENTER, y: Y_READ_PARTNER }, data: { label: "Read Partner",  operationKey: "read_partner",  operationType: "read_data"    } },
      { id: "resolve_email", type: "operation", position: { x: X_CENTER, y: Y_RESOLVE },     data: { label: "Resolve Email",  operationKey: "resolve_email", operationType: "execute_code" } },
      { id: "has_email",    type: "operation", position: { x: X_CENTER, y: Y_COND },         data: { label: "Has Email?",     operationKey: "has_email",     operationType: "condition"    } },
      { id: "send",         type: "operation", position: { x: X_LEFT,   y: Y_SEND },         data: { label: "Send Email",     operationKey: "send",          operationType: "send_email"   } },
      { id: "log_skip",     type: "operation", position: { x: X_RIGHT,  y: Y_SEND },         data: { label: "Log: Skipped",   operationKey: "log_skip",      operationType: "log"          } },
    ],
    edges: [
      { id: "e-0", source: "trigger",       sourceHandle: "default", target: "read_product",  targetHandle: "default" },
      { id: "e-1", source: "read_product",  sourceHandle: "default", target: "read_partner",  targetHandle: "default" },
      { id: "e-2", source: "read_partner",  sourceHandle: "default", target: "resolve_email", targetHandle: "default" },
      { id: "e-3", source: "resolve_email", sourceHandle: "default", target: "has_email",     targetHandle: "default" },
      { id: "e-4", source: "has_email",     sourceHandle: "success", target: "send",          targetHandle: "default" },
      { id: "e-5", source: "has_email",     sourceHandle: "failure", target: "log_skip",      targetHandle: "default" },
    ],
  },

  operations: [
    // ── 1. Read product ───────────────────────────────────────────────────
    {
      operation_key: "read_product",
      operation_type: "read_data",
      name: "Read Product",
      sort_order: 0,
      position_x: X_CENTER,
      position_y: Y_READ_PRODUCT,
      options: {
        entity: "product",
        fields: ["id", "title", "handle", "status"],
        filters: { id: "{{ $trigger.payload.id }}" },
        limit: 1,
      },
    },

    // ── 2. Read owning partner (+ admins for the email) ───────────────────
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
          "admins.id",
          "admins.email",
          "admins.first_name",
          "admins.is_active",
        ],
        filters: { id: "{{ $trigger.payload.partner_id }}" },
        limit: 1,
      },
    },

    // ── 3. Resolve email payload ──────────────────────────────────────────
    {
      operation_key: "resolve_email",
      operation_type: "execute_code",
      name: "Resolve Email",
      sort_order: 2,
      position_x: X_CENTER,
      position_y: Y_RESOLVE,
      options: {
        code: RESOLVE_EMAIL_CODE,
        timeout: 5000,
      },
    },

    // ── 4. Condition: did we resolve a recipient + template? ──────────────
    {
      operation_key: "has_email",
      operation_type: "condition",
      name: "Has Email?",
      sort_order: 3,
      position_x: X_CENTER,
      position_y: Y_COND,
      options: {
        condition_mode: "expression",
        expression: "resolve_email.skipped === false",
        filter_rule: { "resolve_email.skipped": { _eq: false } },
      },
    },

    // ── 5a. Send email (success branch) ───────────────────────────────────
    {
      operation_key: "send",
      operation_type: "send_email",
      name: "Send Email",
      sort_order: 4,
      position_x: X_LEFT,
      position_y: Y_SEND,
      options: {
        to: "{{ resolve_email.to }}",
        subject: "{{ resolve_email.subject }}",
        template: "{{ resolve_email.template }}",
        data: {
          partner_name: "{{ resolve_email.partner_name }}",
          product_title: "{{ resolve_email.product_title }}",
          product_url: "{{ resolve_email.product_url }}",
          reason: "{{ resolve_email.reason }}",
          resubmit_url: "{{ resolve_email.resubmit_url }}",
          store_url: "{{ resolve_email.store_url }}",
          current_year: "{{ resolve_email.current_year }}",
        },
      },
    },

    // ── 5b. Log skip (failure branch) ─────────────────────────────────────
    {
      operation_key: "log_skip",
      operation_type: "log",
      name: "Log: Skipped",
      sort_order: 5,
      position_x: X_RIGHT,
      position_y: Y_SEND,
      options: {
        message:
          "Skipping artisan review email for event {{ $trigger.event }} — reason: {{ resolve_email.reason }}",
        level: "info",
      },
    },
  ],

  connections: [
    { source_id: "trigger",       source_handle: "default", target_id: "read_product",  connection_type: "default" as const },
    { source_id: "read_product",  source_handle: "default", target_id: "read_partner",  connection_type: "default" as const },
    { source_id: "read_partner",  source_handle: "default", target_id: "resolve_email", connection_type: "default" as const },
    { source_id: "resolve_email", source_handle: "default", target_id: "has_email",     connection_type: "default" as const },
    { source_id: "has_email",     source_handle: "success", target_id: "send",          connection_type: "success" as const },
    { source_id: "has_email",     source_handle: "failure", target_id: "log_skip",      connection_type: "failure" as const },
  ],
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export default async function seedArtisanProductApprovalFlow({
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
  console.log(`  1. Seed the templates: artisan-product-approved / artisan-product-rejected`)
  console.log(`       npx medusa exec ./src/scripts/seed-partner-email-templates.ts`)
  console.log(`  2. Flip flow status: draft → active in the admin editor.`)
}

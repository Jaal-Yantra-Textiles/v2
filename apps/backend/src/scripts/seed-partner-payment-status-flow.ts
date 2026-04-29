/**
 * Seed: Partner WhatsApp — Payment Submission Status (single dispatcher)
 *
 * One active flow listens to all `payment_submission.*` events emitted
 * by the create-payment-submission and review-payment-submission
 * workflows. The flow reads the submission + partner, maps the event
 * to a Meta-approved template + variables, and sends via the
 * `send_whatsapp` operation.
 *
 * Template / event mapping (defined inline in the resolve_template node):
 *   payment_submission.created  → jyt_payment_submission_received_v1
 *   payment_submission.rejected → jyt_payment_submission_rejected_v1
 *   payment_submission.paid     → jyt_payment_submission_paid_v1
 *
 * Other events still fire the flow but hit the "skip" branch — no send.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-partner-payment-status-flow.ts
 *
 * Re-seed:
 *   Delete the existing flow (admin UI or by id) and re-run. The script
 *   is idempotent — it refuses to overwrite an existing flow with the
 *   same name.
 *
 * Before activating in admin:
 *   1. Ensure these 3 templates are APPROVED on every WABA you target:
 *        - jyt_payment_submission_received_v1
 *        - jyt_payment_submission_rejected_v1
 *        - jyt_payment_submission_paid_v1
 *      Push them via:
 *        npx medusa exec ./src/scripts/manage-whatsapp-templates.ts
 *      Status check:
 *        MODE=dry-run npx medusa exec ./src/scripts/manage-whatsapp-templates.ts
 *   2. Flip flow status: draft → active in the admin editor.
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"

const FLOW_NAME = "Partner WhatsApp — Payment Submission Status"

// ─── Canvas positions ────────────────────────────────────────────────────────
const X_CENTER = 500
const X_LEFT = 200
const X_RIGHT = 800

const Y_READ_SUBMISSION = 140
const Y_READ_PARTNER = 280
const Y_RESOLVE = 420
const Y_COND = 560
const Y_SEND = 700
const Y_SKIP = 700

// ─── Code for the resolve_template node ──────────────────────────────────────
//
// Returns the full send_whatsapp input payload so the downstream node
// can interpolate from this one operation's output. Returns
// { skipped: true } when the event has no template — drives the
// has_template condition below.
//
// Variables produced (positional, identical order across languages):
//   received: [partnerName, amountWithCurrency, submissionId]
//   rejected: [partnerName, amountWithCurrency, submissionId, reason]
//   paid:     [partnerName, amountWithCurrency, submissionId, paymentMethod]
//
// We resolve `partnerName` from the first active admin's first_name (or
// partner.name as fallback) so the message reads like a real greeting
// rather than "Hi <legal entity>". Language is the admin's
// preferred_language when set, falling back to send_whatsapp's chain
// (conv metadata → phone heuristic → env → "hi").
const RESOLVE_TEMPLATE_CODE = `\
const eventName = $trigger?.event || ""
const expectedSubmissionId = $trigger?.payload?.payment_submission_id || null
const expectedPartnerId = $trigger?.payload?.partner_id || null

const submission = $input.read_submission?.records?.[0]
const partner = $input.read_partner?.records?.[0]

if (!expectedSubmissionId) {
  return { skipped: true, reason: "missing_submission_id_in_payload", event: eventName }
}
if (!expectedPartnerId) {
  return { skipped: true, reason: "no_partner_on_event", event: eventName, submission_id: expectedSubmissionId }
}
if (!submission) {
  return { skipped: true, reason: "submission_not_found", event: eventName, submission_id: expectedSubmissionId }
}
if (!partner) {
  return { skipped: true, reason: "partner_not_found", event: eventName, partner_id: expectedPartnerId }
}

// Pick the first active admin for greeting + phone routing. send_whatsapp
// has its own chain for resolving the destination phone, but supplying a
// concrete \`to\` here keeps the flow audit trail unambiguous.
const admins = Array.isArray(partner.admins) ? partner.admins : []
const activeAdmins = admins.filter(function (a) { return a && a.is_active !== false })
const primary = activeAdmins[0] || admins[0] || null

const partnerName = (primary && primary.first_name)
  ? primary.first_name
  : (partner.name || "Partner")

const phone = (primary && primary.phone) ? primary.phone : (partner.whatsapp_number || null)
if (!phone) {
  return { skipped: true, reason: "no_phone_on_partner", event: eventName, partner_id: expectedPartnerId }
}

const languageCode = (primary && primary.preferred_language) ? primary.preferred_language : ""

// Currency / amount normalization. total_amount is stored as a number
// of major units (e.g. 1500). We emit a single human string so the
// template body can keep one variable instead of two — keeps Meta
// approval simpler and the message reads naturally.
const amount = Number(submission.total_amount || 0)
const currency = (submission.currency || "INR").toUpperCase()
const amountStr = currency + " " + amount.toLocaleString("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const submissionId = submission.id

// Pull payload-level fields the workflows stamp on the event. Falling
// back to submission columns covers the case where a future code path
// fires the event with a thinner payload.
const rejectionReason =
  ($trigger?.payload?.rejection_reason)
    || submission.rejection_reason
    || "Not specified"
const paymentType = $trigger?.payload?.payment_type || "Bank"

const map = {
  "payment_submission.created": {
    template: "jyt_payment_submission_received_v1",
    vars: [partnerName, amountStr, submissionId],
  },
  "payment_submission.rejected": {
    template: "jyt_payment_submission_rejected_v1",
    vars: [partnerName, amountStr, submissionId, rejectionReason],
  },
  "payment_submission.paid": {
    template: "jyt_payment_submission_paid_v1",
    vars: [partnerName, amountStr, submissionId, paymentType],
  },
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
  language_code: languageCode || "",
  context_type: "payment_submission",
  // context_id drives send_whatsapp's 60-min dedup. The submission_id
  // is stable per event so a retried emit dedups, but two genuinely
  // different events on the same submission (created → rejected) carry
  // different event names and the dedup is on (context_type, context_id)
  // — this is fine because rejected/paid happen long after created and
  // we WANT both to fire (partner gets two distinct messages).
  // If a future bug retries within 60 minutes, dedup catches it.
  context_id: submissionId,
  submission_id: submissionId,
}
`

// ─── Flow definition ─────────────────────────────────────────────────────────

const FLOW_DEF = {
  name: FLOW_NAME,
  description:
    "Single dispatcher for partner-facing WhatsApp notifications on every " +
    "payment_submission event. Uses event_pattern to listen to " +
    "payment_submission.*, maps the event to a Meta-approved template via " +
    "an execute_code node, then dispatches through the send_whatsapp " +
    "operation. Templates: received / rejected / paid.",
  status: "draft" as const,
  trigger_type: "event" as const,
  trigger_config: {
    event_pattern: "payment_submission.*",
  },

  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.8 },
    nodes: [
      { id: "trigger", type: "trigger", position: { x: X_CENTER, y: -20 }, data: { label: "Payment Submission — any event", triggerType: "event", triggerConfig: { event_pattern: "payment_submission.*" } } },
      { id: "read_submission",  type: "operation", position: { x: X_CENTER, y: Y_READ_SUBMISSION }, data: { label: "Read Submission",   operationKey: "read_submission",  operationType: "read_data"    } },
      { id: "read_partner",     type: "operation", position: { x: X_CENTER, y: Y_READ_PARTNER },    data: { label: "Read Partner",      operationKey: "read_partner",     operationType: "read_data"    } },
      { id: "resolve_template", type: "operation", position: { x: X_CENTER, y: Y_RESOLVE },         data: { label: "Resolve Template",  operationKey: "resolve_template", operationType: "execute_code" } },
      { id: "has_template",     type: "operation", position: { x: X_CENTER, y: Y_COND },            data: { label: "Has Template?",     operationKey: "has_template",     operationType: "condition"    } },
      { id: "send",             type: "operation", position: { x: X_LEFT,   y: Y_SEND },            data: { label: "Send WhatsApp",     operationKey: "send",             operationType: "send_whatsapp" } },
      { id: "log_skip",         type: "operation", position: { x: X_RIGHT,  y: Y_SKIP },            data: { label: "Log: Skipped",      operationKey: "log_skip",         operationType: "log"          } },
    ],
    edges: [
      { id: "e-0", source: "trigger",          sourceHandle: "default", target: "read_submission",  targetHandle: "default" },
      { id: "e-1", source: "read_submission",  sourceHandle: "default", target: "read_partner",     targetHandle: "default" },
      { id: "e-2", source: "read_partner",     sourceHandle: "default", target: "resolve_template", targetHandle: "default" },
      { id: "e-3", source: "resolve_template", sourceHandle: "default", target: "has_template",     targetHandle: "default" },
      { id: "e-4", source: "has_template",     sourceHandle: "success", target: "send",             targetHandle: "default" },
      { id: "e-5", source: "has_template",     sourceHandle: "failure", target: "log_skip",         targetHandle: "default" },
    ],
  },

  operations: [
    // ── 1. Read payment submission ────────────────────────────────────────
    {
      operation_key: "read_submission",
      operation_type: "read_data",
      name: "Read Submission",
      sort_order: 0,
      position_x: X_CENTER,
      position_y: Y_READ_SUBMISSION,
      options: {
        entity: "payment_submissions",
        fields: [
          "id",
          "partner_id",
          "status",
          "total_amount",
          "currency",
          "rejection_reason",
          "submitted_at",
        ],
        filters: { id: "{{ $trigger.payload.payment_submission_id }}" },
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
          "admins.preferred_language",
        ],
        filters: { id: "{{ $trigger.payload.partner_id }}" },
        limit: 1,
      },
    },

    // ── 3. Resolve template config ────────────────────────────────────────
    {
      operation_key: "resolve_template",
      operation_type: "execute_code",
      name: "Resolve Template",
      sort_order: 2,
      position_x: X_CENTER,
      position_y: Y_RESOLVE,
      options: {
        code: RESOLVE_TEMPLATE_CODE,
        timeout: 5000,
      },
    },

    // ── 4. Condition: was a template resolved? ────────────────────────────
    {
      operation_key: "has_template",
      operation_type: "condition",
      name: "Has Template?",
      sort_order: 3,
      position_x: X_CENTER,
      position_y: Y_COND,
      options: {
        condition_mode: "expression",
        // Skipped === true → failure branch (log only). false → success branch (send).
        expression: "resolve_template.skipped === false",
        filter_rule: { "resolve_template.skipped": { _eq: false } },
      },
    },

    // ── 5a. Send WhatsApp template (success branch) ───────────────────────
    {
      operation_key: "send",
      operation_type: "send_whatsapp",
      name: "Send WhatsApp",
      sort_order: 4,
      position_x: X_LEFT,
      position_y: Y_SEND,
      options: {
        to: "{{ resolve_template.to }}",
        partner_id: "{{ resolve_template.partner_id }}",
        mode: "template",
        template_name: "{{ resolve_template.template_name }}",
        variables: "{{ resolve_template.variables }}",
        language_code: "{{ resolve_template.language_code }}",
        context_type: "{{ resolve_template.context_type }}",
        context_id: "{{ resolve_template.context_id }}",
        // 60-min dedup blocks accidental double-sends from event retries.
        // Different events on the same submission carry the same context_id
        // but happen long after each other, so legitimate progression
        // (created → rejected | paid) still delivers.
        dedup_window_minutes: 60,
        require_partner: true,
      },
    },

    // ── 5b. Log skip (failure branch) ─────────────────────────────────────
    {
      operation_key: "log_skip",
      operation_type: "log",
      name: "Log: Skipped",
      sort_order: 5,
      position_x: X_RIGHT,
      position_y: Y_SKIP,
      options: {
        message:
          "Skipping payment WhatsApp for event {{ $trigger.event }} — reason: {{ resolve_template.reason }}",
        level: "info",
      },
    },
  ],

  connections: [
    { source_id: "trigger",          source_handle: "default", target_id: "read_submission",  connection_type: "default" as const },
    { source_id: "read_submission",  source_handle: "default", target_id: "read_partner",     connection_type: "default" as const },
    { source_id: "read_partner",     source_handle: "default", target_id: "resolve_template", connection_type: "default" as const },
    { source_id: "resolve_template", source_handle: "default", target_id: "has_template",     connection_type: "default" as const },
    { source_id: "has_template",     source_handle: "success", target_id: "send",             connection_type: "success" as const },
    { source_id: "has_template",     source_handle: "failure", target_id: "log_skip",         connection_type: "failure" as const },
  ],
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export default async function seedPartnerPaymentStatusFlow({
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
  console.log(`  1. Ensure these 3 templates are APPROVED on every WABA you target:`)
  console.log(`     - jyt_payment_submission_received_v1`)
  console.log(`     - jyt_payment_submission_rejected_v1`)
  console.log(`     - jyt_payment_submission_paid_v1`)
  console.log(`     Push via:`)
  console.log(`       npx medusa exec ./src/scripts/manage-whatsapp-templates.ts`)
  console.log(`     Status check:`)
  console.log(`       MODE=dry-run npx medusa exec ./src/scripts/manage-whatsapp-templates.ts`)
  console.log(`  2. Flip flow status: draft → active in the admin editor.`)
}

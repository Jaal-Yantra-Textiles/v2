/**
 * ⚠️  DEPRECATED — superseded by seed-partner-run-whatsapp-flow.ts.
 *
 * This script predates the `send_whatsapp` visual-flow operation and the
 * multi-number routing layer. It builds a flow out of three `execute_code`
 * nodes that hit Meta Graph directly via env vars (WHATSAPP_PHONE_NUMBER_ID
 * / WHATSAPP_ACCESS_TOKEN), bypassing every SocialPlatform row and the
 * per-conversation sender pin. It also hardcodes the English `en` language
 * and never persists a `messaging_message` row — no audit trail.
 *
 * The replacement is `src/scripts/seed-partner-run-whatsapp-flow.ts`, which
 * is a single wildcard-triggered dispatcher flow that:
 *   - uses the `send_whatsapp` operation (correct routing + persistence)
 *   - maps every production_run.* event to its Meta-approved template
 *   - respects partner language choice from conversation metadata
 *
 * Do NOT seed this flow alongside the new one — doing so causes double
 * sends on the `sent_to_partner` event. This script is gated behind
 * `FORCE_OLD_SEED=1` so nobody accidentally runs it.
 *
 * Original description kept below for historical context:
 *
 * Sends WhatsApp utility template messages to partners on production run events.
 * Uses templates (not free-form) so messages are delivered regardless of the
 * 24-hour window state. Utility templates are free when the window is open.
 *
 * Pipeline:
 *   1. Trigger: production_run.sent_to_partner event
 *   2. Read production run details (design name, quantity, partner)
 *   3. Resolve partner phone number
 *   4. Condition: partner has a verified WhatsApp number?
 *      YES → Send WhatsApp utility template via HTTP request to our own API
 *      NO  → Log and skip
 *
 * Usage:
 *   npx medusa exec src/scripts/seed-production-run-whatsapp-flow.ts
 *
 * Before activating:
 *   - Ensure the "jyt_production_run_assigned" template is approved in Meta
 *   - Update the template name in the send_template operation if different
 *   - Set MEDUSA_BACKEND_URL env var for the internal API call
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"

const FLOW_NAME = "Production Run — WhatsApp Partner Notification"

// ─── Positions ────────────────────────────────────────────────────────────────
const X_CENTER = 500
const X_LEFT   = 200  // send branch
const X_RIGHT  = 800  // skip branch

const Y_READ_RUN     = 140
const Y_READ_PARTNER = 300
const Y_RESOLVE      = 460
const Y_COND         = 620
const Y_SEND         = 800
const Y_PERSIST      = 970
const Y_LOG_SKIP     = 800

// ─── Code snippets ───────────────────────────────────────────────────────────

const RESOLVE_PARTNER_PHONE_CODE = `\
// Resolve the partner's WhatsApp phone number
// Priority: verified whatsapp_number, then first active admin phone
const partner = $input.read_partner?.records?.[0]
if (!partner) return { phone: null, partner_name: "Unknown" }

const partnerName = partner.name || "Partner"

if (partner.whatsapp_number && partner.whatsapp_verified) {
  return { phone: partner.whatsapp_number, partner_name: partnerName }
}

// Fall back to admin phones
const admins = partner.admins || []
const activeAdmin = admins.find(a => a.is_active && a.phone)
return {
  phone: activeAdmin?.phone || null,
  partner_name: partnerName,
}
`

const SEND_TEMPLATE_CODE = `\
// Build the WhatsApp template message payload and send via Meta Graph API
const run = $input.read_run?.records?.[0]
const resolved = $input.resolve_phone
const phone = resolved?.phone
const partnerName = resolved?.partner_name || "Partner"
const designName = run?.design?.name || run?.design_id || "Unknown Design"
const quantity = run?.quantity || 0
const runId = run?.id || $trigger.id

if (!phone) return { sent: false, reason: "No phone number" }

// Use the WhatsApp Cloud API directly
// Template: jyt_production_run_assigned (utility category)
// Parameters: {{1}} = partner name, {{2}} = design name, {{3}} = quantity, {{4}} = run ID
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
const accessToken = process.env.WHATSAPP_ACCESS_TOKEN

if (!phoneNumberId || !accessToken) {
  return { sent: false, reason: "WhatsApp not configured" }
}

const templateName = "jyt_production_run_assigned"

const response = await fetch(
  \`https://graph.facebook.com/v21.0/\${phoneNumberId}/messages\`,
  {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${accessToken}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: partnerName },
            { type: "text", text: designName },
            { type: "text", text: String(quantity) },
            { type: "text", text: runId },
          ],
        }],
      },
    }),
  }
)

const result = await response.json()
return {
  sent: response.ok,
  wa_message_id: result?.messages?.[0]?.id || null,
  phone,
  template: templateName,
  run_id: runId,
  design: designName,
}
`

const PERSIST_MESSAGE_CODE = `\
// Persist the sent template message in the messaging module for tracking
const sendResult = $input.send_template
const run = $input.read_run?.records?.[0]
const partner = $input.read_partner?.records?.[0]

if (!sendResult?.sent) return { persisted: false, reason: sendResult?.reason }

return {
  partner_id: partner?.id || run?.partner_id,
  phone: sendResult.phone,
  content: \`Production Run Assigned — \${sendResult.design} (\${sendResult.run_id})\`,
  wa_message_id: sendResult.wa_message_id,
  run_id: sendResult.run_id,
  persisted: true,
}
`

// ─── Flow definition ──────────────────────────────────────────────────────────

const FLOW_DEF = {
  name: FLOW_NAME,
  description:
    "Sends a WhatsApp utility template to the partner when a production run is assigned. " +
    "Uses templates to bypass the 24-hour window. Utility templates are free when the window is open.",
  status: "draft" as const,
  trigger_type: "event" as const,
  trigger_config: {
    event_type: "production_run.sent_to_partner",
  },

  // ── Canvas layout ──────────────────────────────────────────────────────────
  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.65 },
    nodes: [
      { id: "trigger", type: "trigger", position: { x: X_CENTER, y: -20 }, data: { label: "Production Run Sent to Partner", triggerType: "event", triggerConfig: { event_type: "production_run.sent_to_partner" } } },
      { id: "read_run",        type: "operation", position: { x: X_CENTER, y: Y_READ_RUN     }, data: { label: "Read Production Run",    operationKey: "read_run",        operationType: "read_data"     } },
      { id: "read_partner",    type: "operation", position: { x: X_CENTER, y: Y_READ_PARTNER  }, data: { label: "Read Partner",           operationKey: "read_partner",    operationType: "read_data"     } },
      { id: "resolve_phone",   type: "operation", position: { x: X_CENTER, y: Y_RESOLVE       }, data: { label: "Resolve Partner Phone",  operationKey: "resolve_phone",   operationType: "execute_code"  } },
      { id: "has_phone",       type: "operation", position: { x: X_CENTER, y: Y_COND          }, data: { label: "Has WhatsApp Phone?",    operationKey: "has_phone",       operationType: "condition"     } },
      // Send branch (left)
      { id: "send_template",   type: "operation", position: { x: X_LEFT,   y: Y_SEND          }, data: { label: "Send WhatsApp Template", operationKey: "send_template",   operationType: "execute_code"  } },
      { id: "persist_message", type: "operation", position: { x: X_LEFT,   y: Y_PERSIST       }, data: { label: "Persist Message",        operationKey: "persist_message", operationType: "execute_code"  } },
      // Skip branch (right)
      { id: "log_skip",        type: "operation", position: { x: X_RIGHT,  y: Y_LOG_SKIP      }, data: { label: "Log: No Phone",          operationKey: "log_skip",        operationType: "log"           } },
    ],
    edges: [
      { id: "e-0", source: "trigger",        sourceHandle: "default", target: "read_run",        targetHandle: "default" },
      { id: "e-1", source: "read_run",        sourceHandle: "default", target: "read_partner",    targetHandle: "default" },
      { id: "e-2", source: "read_partner",    sourceHandle: "default", target: "resolve_phone",   targetHandle: "default" },
      { id: "e-3", source: "resolve_phone",   sourceHandle: "default", target: "has_phone",       targetHandle: "default" },
      { id: "e-4", source: "has_phone",       sourceHandle: "success", target: "send_template",   targetHandle: "default" },
      { id: "e-5", source: "has_phone",       sourceHandle: "failure", target: "log_skip",        targetHandle: "default" },
      { id: "e-6", source: "send_template",   sourceHandle: "default", target: "persist_message", targetHandle: "default" },
    ],
  },

  // ── Operations ─────────────────────────────────────────────────────────────
  operations: [
    // ── 1. Read Production Run ────────────────────────────────────────────────
    {
      operation_key: "read_run",
      operation_type: "read_data",
      name: "Read Production Run",
      sort_order: 0,
      position_x: X_CENTER,
      position_y: Y_READ_RUN,
      options: {
        entity: "production_run",
        fields: [
          "id", "partner_id", "design_id", "quantity", "run_type", "status",
          "design.id", "design.name",
        ],
        filters: { id: "{{ $trigger.id }}" },
        limit: 1,
      },
    },

    // ── 2. Read Partner ───────────────────────────────────────────────────────
    {
      operation_key: "read_partner",
      operation_type: "read_data",
      name: "Read Partner",
      sort_order: 1,
      position_x: X_CENTER,
      position_y: Y_READ_PARTNER,
      options: {
        entity: "partners",
        fields: ["id", "name", "whatsapp_number", "whatsapp_verified", "admins.*"],
        filters: { id: "{{ read_run.records[0].partner_id }}" },
        limit: 1,
      },
    },

    // ── 3. Resolve Partner Phone ──────────────────────────────────────────────
    {
      operation_key: "resolve_phone",
      operation_type: "execute_code",
      name: "Resolve Partner Phone",
      sort_order: 2,
      position_x: X_CENTER,
      position_y: Y_RESOLVE,
      options: {
        code: RESOLVE_PARTNER_PHONE_CODE,
        timeout: 5000,
      },
    },

    // ── 4. Condition: Has WhatsApp Phone? ─────────────────────────────────────
    {
      operation_key: "has_phone",
      operation_type: "condition",
      name: "Has WhatsApp Phone?",
      sort_order: 3,
      position_x: X_CENTER,
      position_y: Y_COND,
      options: {
        condition_mode: "expression",
        expression: "resolve_phone.phone != null",
        filter_rule: { "resolve_phone.phone": { _neq: null } },
      },
    },

    // ── 5a. Send WhatsApp Template ────────────────────────────────────────────
    {
      operation_key: "send_template",
      operation_type: "execute_code",
      name: "Send WhatsApp Template",
      sort_order: 4,
      position_x: X_LEFT,
      position_y: Y_SEND,
      options: {
        code: SEND_TEMPLATE_CODE,
        timeout: 15000,
      },
    },

    // ── 6a. Persist Message ───────────────────────────────────────────────────
    {
      operation_key: "persist_message",
      operation_type: "execute_code",
      name: "Persist Message",
      sort_order: 5,
      position_x: X_LEFT,
      position_y: Y_PERSIST,
      options: {
        code: PERSIST_MESSAGE_CODE,
        timeout: 5000,
      },
    },

    // ── 5b. Log Skip ─────────────────────────────────────────────────────────
    {
      operation_key: "log_skip",
      operation_type: "log",
      name: "Log: No Phone",
      sort_order: 6,
      position_x: X_RIGHT,
      position_y: Y_LOG_SKIP,
      options: {
        message: "Skipping WhatsApp notification for production run {{ $trigger.id }} — no partner phone number found.",
        level: "warn",
      },
    },
  ],

  // ── Connections ─────────────────────────────────────────────────────────────
  connections: [
    { source_id: "trigger",        source_handle: "default", target_id: "read_run",        connection_type: "default" as const },
    { source_id: "read_run",        source_handle: "default", target_id: "read_partner",    connection_type: "default" as const },
    { source_id: "read_partner",    source_handle: "default", target_id: "resolve_phone",   connection_type: "default" as const },
    { source_id: "resolve_phone",   source_handle: "default", target_id: "has_phone",       connection_type: "default" as const },
    { source_id: "has_phone",       source_handle: "success", target_id: "send_template",   connection_type: "success" as const },
    { source_id: "has_phone",       source_handle: "failure", target_id: "log_skip",        connection_type: "failure" as const },
    { source_id: "send_template",   source_handle: "default", target_id: "persist_message", connection_type: "default" as const },
  ],
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export default async function seedProductionRunWhatsAppFlow({ container }: { container: any }) {
  if (process.env.FORCE_OLD_SEED !== "1") {
    console.warn(
      `[DEPRECATED] ${FLOW_NAME} is obsolete. The replacement is ` +
        `seed-partner-run-whatsapp-flow.ts which uses the send_whatsapp ` +
        `operation + multi-number routing.\n\n` +
        `If you really need to run this legacy seed, re-run with FORCE_OLD_SEED=1 ` +
        `— but note it will double-send on sent_to_partner events when the ` +
        `new flow is also active.`
    )
    return
  }

  const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)

  const [existing] = await service.listVisualFlows({ name: FLOW_NAME } as any)

  if (existing) {
    console.log(`Flow "${FLOW_NAME}" already exists (${existing.id}) — skipping.`)
    console.log("Delete it first or rename it if you want to re-seed.")
    return
  }

  console.log(`Creating flow "${FLOW_NAME}"...`)

  const flow = await service.createCompleteFlow({
    flow: {
      name:           FLOW_DEF.name,
      description:    FLOW_DEF.description,
      status:         FLOW_DEF.status,
      trigger_type:   FLOW_DEF.trigger_type,
      trigger_config: FLOW_DEF.trigger_config,
    },
    operations: FLOW_DEF.operations,
    connections: FLOW_DEF.connections,
  })

  console.log(`Flow created: ${flow.id}`)
  console.log(`  Open it at: /app/visual-flows/${flow.id}`)
  console.log()
  console.log("  Before activating:")
  console.log("  1. Create & get approved the 'jyt_production_run_assigned' template in Meta")
  console.log("     Category: UTILITY")
  console.log("     Body: 'Hi {{1}}, you have a new production run for {{2}} (qty: {{3}}). Run ID: {{4}}'")
  console.log("  2. Or update the template name in the 'Send WhatsApp Template' execute_code step")
  console.log("  3. Ensure WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN env vars are set")
  console.log("  4. Set flow status to 'active' in the visual flows editor")
}

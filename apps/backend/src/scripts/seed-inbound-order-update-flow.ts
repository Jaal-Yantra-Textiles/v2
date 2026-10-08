/**
 * Seed: Inbound Order Updates — Visual Flow
 *
 * A supplier's follow-up email about an order we already have ("shipped",
 * tracking number, new ETA) becomes one row on that inventory order's timeline.
 *
 *   1. Read the inbound email
 *   2. AI-extract the order number and the update
 *   3. Run `log-inbound-order-update`: exactly one order with that supplier
 *      order number → activity row + email linked and processed; none or
 *      several → nothing written, email left `received` with the reason
 *
 * It changes no status, books no shipment and creates no order. Compare
 * seed-order-upsert-flow.ts, which creates orders and matches on
 * `metadata.order_number` only, so it misses orders the assistant records
 * (they carry `supplier_order_number`) and would create a duplicate.
 *
 * Usage:
 *   npx medusa exec src/scripts/seed-inbound-order-update-flow.ts
 *
 * Created as `draft`. Activate it on the Visual Flows page once read.
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"
import { LOG_INBOUND_ORDER_UPDATE_WORKFLOW } from "../workflows/inbound-emails/log-inbound-order-update"

export const INBOUND_ORDER_UPDATE_FLOW_NAME = "Inbound Order Updates"

const EVENT = "inbound_emails.inbound-email.created"
const X = 500

export const INBOUND_ORDER_UPDATE_FLOW_DEF = {
  name: INBOUND_ORDER_UPDATE_FLOW_NAME,
  description:
    "A supplier's email about an order we already have (shipped, tracking, ETA) is logged " +
    "on that inventory order's timeline. Matches by supplier order number; changes nothing else.",
  status: "draft" as const,
  trigger_type: "event" as const,
  trigger_config: { event_type: EVENT },

  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.8 },
    nodes: [
      { id: "trigger", type: "trigger", position: { x: X, y: -20 }, data: { label: "Event Trigger", triggerType: "event", triggerConfig: { event_type: EVENT } } },
      { id: "read_email", type: "operation", position: { x: X, y: 140 }, data: { label: "Read Email", operationKey: "read_email", operationType: "read_data" } },
      { id: "parse_update", type: "operation", position: { x: X, y: 300 }, data: { label: "Extract Update", operationKey: "parse_update", operationType: "ai_extract" } },
      { id: "log_update", type: "operation", position: { x: X, y: 460 }, data: { label: "Log on Order", operationKey: "log_update", operationType: "trigger_workflow" } },
    ],
    edges: [
      { id: "e-0", source: "trigger", sourceHandle: "default", target: "read_email", targetHandle: "default" },
      { id: "e-1", source: "read_email", sourceHandle: "default", target: "parse_update", targetHandle: "default" },
      { id: "e-2", source: "parse_update", sourceHandle: "default", target: "log_update", targetHandle: "default" },
    ],
  },

  operations: [
    {
      operation_key: "read_email",
      operation_type: "read_data",
      name: "Read Email",
      sort_order: 0,
      position_x: X,
      position_y: 140,
      options: {
        entity: "inbound_email",
        fields: ["id", "subject", "text_body", "html_body", "from_address"],
        filters: { id: "{{ $trigger.id }}" },
        limit: 1,
      },
    },
    {
      operation_key: "parse_update",
      operation_type: "ai_extract",
      name: "Extract Update",
      sort_order: 1,
      position_x: X,
      position_y: 300,
      options: {
        // Model comes from the AI platform configured for this role.
        role: "ai_search_chat",
        input:
          "From: {{ read_email.records[0].from_address }}\n" +
          "Subject: {{ read_email.records[0].subject }}\n\n" +
          "{{ read_email.records[0].html_body }}",
        system_prompt:
          "This is an email from a supplier we bought from. Extract the supplier's own order " +
          "number and what the email says about the order. Copy the order number exactly as " +
          "written (e.g. JH27228). Use null for anything the email does not state; never guess.",
        schema_fields: [
          { name: "order_number", type: "string", required: true, description: "The supplier's order number" },
          {
            name: "update_type",
            type: "enum",
            enumValues: ["Confirmed", "Packed", "Shipped", "Out for delivery", "Delivered", "Delayed", "Cancelled", "Other"],
            description: "What happened to the order",
          },
          { name: "status_text", type: "string", description: "The status in the email's own words" },
          { name: "carrier", type: "string", description: "Courier name, e.g. Delhivery" },
          { name: "tracking_number", type: "string", description: "AWB / tracking number" },
          { name: "tracking_url", type: "string", description: "Tracking link" },
          { name: "expected_delivery_date", type: "string", description: "Expected delivery, YYYY-MM-DD" },
          { name: "summary", type: "string", description: "One short sentence on the update" },
        ],
        fallback_on_error: false,
      },
    },
    {
      operation_key: "log_update",
      operation_type: "trigger_workflow",
      name: "Log on Order",
      sort_order: 2,
      position_x: X,
      position_y: 460,
      options: {
        workflow_name: LOG_INBOUND_ORDER_UPDATE_WORKFLOW,
        input: {
          inbound_email_id: "{{ $trigger.id }}",
          extracted: "{{ parse_update }}",
        },
        wait_for_completion: true,
      },
    },
  ],

  connections: [
    { source_id: "trigger", source_handle: "default", target_id: "read_email", connection_type: "default" as const },
    { source_id: "read_email", source_handle: "default", target_id: "parse_update", connection_type: "default" as const },
    { source_id: "parse_update", source_handle: "default", target_id: "log_update", connection_type: "default" as const },
  ],
}

export default async function seedInboundOrderUpdateFlow({ container }: { container: any }) {
  const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)
  const def = INBOUND_ORDER_UPDATE_FLOW_DEF

  const [existing] = await service.listVisualFlows({ name: def.name } as any)
  if (existing) {
    console.log(`Flow "${def.name}" already exists (${existing.id}) — skipping.`)
    return
  }

  const flow = await service.createCompleteFlow({
    flow: {
      name: def.name,
      description: def.description,
      status: def.status,
      trigger_type: def.trigger_type,
      trigger_config: def.trigger_config,
      canvas_state: def.canvas_state,
    },
    operations: def.operations,
    connections: def.connections,
  })

  console.log(`✓ Flow created (draft): ${flow.id}  →  /app/visual-flows/${flow.id}`)
}

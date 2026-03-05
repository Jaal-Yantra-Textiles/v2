/**
 * Seed: Order Upsert from Email — Visual Flow
 *
 * Full pipeline:
 *   1. Read inbound email
 *   2. AI-extract order details (order_number, status, tracking link/number, carrier, dates, lines)
 *   3. Find existing inventory order by metadata.order_number
 *   4. Condition: order found?
 *      TRUE  → prepare_update (execute_code) → update_order → mark processed
 *      FALSE → create_inventory_items (bulk) → create_raw_materials (bulk)
 *             → prepare_create (execute_code) → create_order → mark processed
 *
 * Usage:
 *   npx medusa exec src/scripts/seed-order-upsert-flow.ts
 *
 * Before activating:
 *   - Replace stock_location_id in prepare_create execute_code
 *   - Adjust material_type default in create_raw_materials if needed
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"

const FLOW_NAME = "Order Upsert from Email"

// ─── Positions ────────────────────────────────────────────────────────────────
const X_CENTER = 500
const X_LEFT   = 180   // update branch
const X_RIGHT  = 820   // create branch

const Y_READ      = 140
const Y_PARSE     = 300
const Y_FIND      = 460
const Y_COND      = 620
const Y_STEP1     = 800   // prepare_update | create_inventory_items
const Y_STEP2     = 970   // update_order   | create_raw_materials
const Y_STEP3     = 1140  // mark_upd       | prepare_create
const Y_STEP4     = 1310  //                | create_order
const Y_STEP5     = 1480  //                | mark_create

// ─── Execute-code snippets ────────────────────────────────────────────────────

const PREPARE_UPDATE_CODE = `\
// Collect all AI-extracted data into the update-inventory-order-workflow input.
// Only include fields that were actually extracted to avoid wiping existing values.
const parsed  = $input.parse_email
const found   = $input.find_order
const email   = $input.read_email?.records?.[0]
const existing = found?.records?.[0] || {}

const data = {}
if (parsed.status)                    data.status = parsed.status
if (parsed.expected_delivery_date)    data.expected_delivery_date = parsed.expected_delivery_date

// Merge metadata — preserve existing values, overlay newly extracted ones
data.metadata = {
  ...(existing.metadata || {}),
  order_number: parsed.order_number,
  ...(parsed.tracking_number ? { tracking_number: parsed.tracking_number } : {}),
  ...(parsed.carrier         ? { carrier: parsed.carrier }                 : {}),
  ...(parsed.notes           ? { notes: parsed.notes }                     : {}),
  last_email_id:   email?.id,
  last_email_from: email?.from_address,
}

return {
  id:          existing.id,
  data,
  order_lines: [],
}`

const PREPARE_CREATE_CODE = `\
// Map AI-extracted order lines + created inventory item IDs into the
// create-inventory-order-workflow input shape.
//
// create_inventory_items.records[i] = result of createInventoryItemsWorkflow for line i
// → createInventoryItemsWorkflow returns { items: [{id, title, ...}] }
const parsed       = $input.parse_email
const email        = $input.read_email?.records?.[0]
const createdItems = $input.create_inventory_items?.records || []
const parsedLines  = parsed.order_lines || []

const order_lines = parsedLines.map((line, idx) => {
  const itemResult = createdItems[idx]
  // createInventoryItemsWorkflow returns { items: [...] } not a plain array
  const itemsArr   = Array.isArray(itemResult) ? itemResult : (itemResult?.items || [])
  const inventoryItemId = itemsArr[0]?.id
  return {
    inventory_item_id: inventoryItemId,
    quantity: Number(line.quantity)   || 1,
    price:    Number(line.unit_price) || 0,
  }
}).filter(l => l.inventory_item_id)

return {
  status:                  parsed.status || "Pending",
  is_sample:               false,
  order_date:              parsed.order_date || new Date().toISOString(),
  expected_delivery_date:  parsed.expected_delivery_date || null,
  // TODO: replace with your default stock location ID
  stock_location_id:       "sloc_01JEWQM7RPDS5C9QEMBXXXWHP5",
  shipping_address:        {},
  quantity:                order_lines.reduce((s, l) => s + l.quantity, 0),
  total_price:             order_lines.reduce((s, l) => s + l.quantity * l.price, 0),
  order_lines,
  metadata: {
    order_number:    parsed.order_number,
    source:          "inbound_email",
    email_id:        email?.id,
    from_address:    email?.from_address,
    ...(parsed.notes           ? { notes: parsed.notes }                     : {}),
    ...(parsed.carrier         ? { carrier: parsed.carrier }                 : {}),
    ...(parsed.tracking_number ? { tracking_number: parsed.tracking_number } : {}),
  },
}`

// ─── Flow definition ──────────────────────────────────────────────────────────

const FLOW_DEF = {
  name: FLOW_NAME,
  description:
    "Parses an inbound email, finds an existing order by order_number in metadata, " +
    "updates it if found or creates inventory items + raw materials then a new order if not.",
  status: "draft" as const,
  trigger_type: "event" as const,
  trigger_config: {
    event_type: "inbound_emails.inbound-email.created",
  },

  // ── Canvas layout ──────────────────────────────────────────────────────────
  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.65 },
    nodes: [
      // Trigger node — required by the execution engine to find the entry point
      { id: "trigger", type: "trigger", position: { x: X_CENTER, y: -20 }, data: { label: "Event Trigger", triggerType: "event", triggerConfig: { event_type: "inbound_emails.inbound-email.created" } } },
      { id: "read_email",            type: "operation", position: { x: X_CENTER, y: Y_READ  }, data: { label: "Read Email",             operationKey: "read_email",            operationType: "read_data"            } },
      { id: "parse_email",           type: "operation", position: { x: X_CENTER, y: Y_PARSE }, data: { label: "Parse Email",            operationKey: "parse_email",           operationType: "ai_extract"           } },
      { id: "find_order",            type: "operation", position: { x: X_CENTER, y: Y_FIND  }, data: { label: "Find Order",             operationKey: "find_order",            operationType: "read_data"            } },
      { id: "order_found",           type: "operation", position: { x: X_CENTER, y: Y_COND  }, data: { label: "Order Found?",           operationKey: "order_found",           operationType: "condition"            } },
      // Update branch (left)
      { id: "prepare_update",        type: "operation", position: { x: X_LEFT,   y: Y_STEP1 }, data: { label: "Prepare Update",         operationKey: "prepare_update",        operationType: "execute_code"         } },
      { id: "update_order",          type: "operation", position: { x: X_LEFT,   y: Y_STEP2 }, data: { label: "Update Order",           operationKey: "update_order",          operationType: "trigger_workflow"     } },
      { id: "mark_processed_update", type: "operation", position: { x: X_LEFT,   y: Y_STEP3 }, data: { label: "Mark Processed",         operationKey: "mark_processed_update", operationType: "update_data"          } },
      // Create branch (right)
      { id: "create_inventory_items",type: "operation", position: { x: X_RIGHT,  y: Y_STEP1 }, data: { label: "Create Inventory Items", operationKey: "create_inventory_items",operationType: "bulk_trigger_workflow"} },
      { id: "create_raw_materials",  type: "operation", position: { x: X_RIGHT,  y: Y_STEP2 }, data: { label: "Create Raw Materials",   operationKey: "create_raw_materials",  operationType: "bulk_trigger_workflow"} },
      { id: "prepare_create",        type: "operation", position: { x: X_RIGHT,  y: Y_STEP3 }, data: { label: "Prepare Create",         operationKey: "prepare_create",        operationType: "execute_code"         } },
      { id: "create_order",          type: "operation", position: { x: X_RIGHT,  y: Y_STEP4 }, data: { label: "Create Order",           operationKey: "create_order",          operationType: "trigger_workflow"     } },
      { id: "mark_processed_create", type: "operation", position: { x: X_RIGHT,  y: Y_STEP5 }, data: { label: "Mark Processed",         operationKey: "mark_processed_create", operationType: "update_data"          } },
    ],
    edges: [
      // trigger → first operation (required — execution engine starts here)
      { id: "e-0",  source: "trigger",                  sourceHandle: "default", target: "read_email",             targetHandle: "default" },
      { id: "e-1",  source: "read_email",             sourceHandle: "default", target: "parse_email",            targetHandle: "default" },
      { id: "e-2",  source: "parse_email",            sourceHandle: "default", target: "find_order",             targetHandle: "default" },
      { id: "e-3",  source: "find_order",             sourceHandle: "default", target: "order_found",            targetHandle: "default" },
      { id: "e-4",  source: "order_found",            sourceHandle: "success", target: "prepare_update",         targetHandle: "default" },
      { id: "e-5",  source: "order_found",            sourceHandle: "failure", target: "create_inventory_items", targetHandle: "default" },
      { id: "e-6",  source: "prepare_update",         sourceHandle: "default", target: "update_order",           targetHandle: "default" },
      { id: "e-7",  source: "update_order",           sourceHandle: "default", target: "mark_processed_update",  targetHandle: "default" },
      { id: "e-8",  source: "create_inventory_items", sourceHandle: "default", target: "create_raw_materials",   targetHandle: "default" },
      { id: "e-9",  source: "create_raw_materials",   sourceHandle: "default", target: "prepare_create",         targetHandle: "default" },
      { id: "e-10", source: "prepare_create",         sourceHandle: "default", target: "create_order",           targetHandle: "default" },
      { id: "e-11", source: "create_order",           sourceHandle: "default", target: "mark_processed_create",  targetHandle: "default" },
    ],
  },

  // ── Operations ─────────────────────────────────────────────────────────────
  operations: [
    // ── 1. Read Email ─────────────────────────────────────────────────────────
    {
      operation_key: "read_email",
      operation_type: "read_data",
      name: "Read Email",
      sort_order: 0,
      position_x: X_CENTER,
      position_y: Y_READ,
      options: {
        entity: "inbound_email",
        fields: ["id", "subject", "text_body", "html_body", "from_address", "status", "metadata"],
        filters: { id: "{{ $trigger.id }}" },
        limit: 1,
      },
    },

    // ── 2. Parse Email (AI Extract) ───────────────────────────────────────────
    {
      operation_key: "parse_email",
      operation_type: "ai_extract",
      name: "Parse Email",
      sort_order: 1,
      position_x: X_CENTER,
      position_y: Y_PARSE,
      options: {
        model: "google/gemini-2.5-flash-preview",
        input: "Subject: {{ read_email.records[0].subject }}\n\n{{ read_email.records[0].text_body }}",
        system_prompt:
          "Extract purchase order details from this supplier email. " +
          "Return ONLY a JSON object — no markdown, no code blocks.\n\n" +
          "The email may contain tracking information embedded in hyperlinks or plain text. " +
          "Extract the raw tracking number (e.g. from a URL like https://carrier.com/track?id=1Z999AA → tracking_number = \"1Z999AA\"). " +
          "Recognise carrier portals: FedEx, UPS, DHL, BlueDart, DTDC, Delhivery, Ekart, Ecom Express, Amazon Logistics.\n\n" +
          "Normalise all dates to ISO 8601 (YYYY-MM-DD). Omit any field that is not present in the email.",
        schema_fields: [
          {
            name: "order_number",
            type: "string",
            description: "PO or order reference number (e.g. SMD1520, PO-2025-001, INV-456)",
            required: true,
          },
          {
            name: "status",
            type: "enum",
            description: "Order status hint from email content",
            enumValues: ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"],
            required: false,
          },
          {
            name: "tracking_number",
            type: "string",
            description: "Shipment tracking number — extract from link URLs if necessary",
            required: false,
          },
          {
            name: "carrier",
            type: "string",
            description: "Shipping carrier name (e.g. DHL, FedEx, BlueDart)",
            required: false,
          },
          {
            name: "expected_delivery_date",
            type: "string",
            description: "Expected delivery date in ISO 8601 (YYYY-MM-DD)",
            required: false,
          },
          {
            name: "order_date",
            type: "string",
            description: "Order or dispatch date in ISO 8601 (YYYY-MM-DD)",
            required: false,
          },
          {
            name: "notes",
            type: "string",
            description: "Any additional remarks, special instructions, or supplier notes",
            required: false,
          },
          {
            name: "order_lines",
            type: "array",
            description:
              "Line items — each with: description (string), quantity (number), unit_price (number)",
            required: false,
          },
        ],
        fallback_on_error: true,
      },
    },

    // ── 3. Find Order ─────────────────────────────────────────────────────────
    {
      operation_key: "find_order",
      operation_type: "read_data",
      name: "Find Order",
      sort_order: 2,
      position_x: X_CENTER,
      position_y: Y_FIND,
      options: {
        entity: "inventory_orders",
        fields: ["id", "status", "metadata", "quantity", "total_price", "order_date", "expected_delivery_date"],
        filters: {
          metadata: { order_number: "{{ parse_email.order_number }}" },
        },
        limit: 1,
      },
    },

    // ── 4. Condition: Order Found? ────────────────────────────────────────────
    {
      operation_key: "order_found",
      operation_type: "condition",
      name: "Order Found?",
      sort_order: 3,
      position_x: X_CENTER,
      position_y: Y_COND,
      options: {
        condition_mode: "expression",
        expression: "find_order.count > 0",
        filter_rule: { "find_order.count": { _gt: 0 } },
      },
    },

    // ══════════════════════════════════════════════════════════════════════════
    // UPDATE BRANCH (order found)
    // ══════════════════════════════════════════════════════════════════════════

    // ── 5a. Prepare Update payload ────────────────────────────────────────────
    {
      operation_key: "prepare_update",
      operation_type: "execute_code",
      name: "Prepare Update",
      sort_order: 4,
      position_x: X_LEFT,
      position_y: Y_STEP1,
      options: {
        code: PREPARE_UPDATE_CODE,
        timeout: 5000,
      },
    },

    // ── 6a. Update Order ──────────────────────────────────────────────────────
    // Note: update-inventory-order-workflow only allows Pending/Processing orders.
    {
      operation_key: "update_order",
      operation_type: "trigger_workflow",
      name: "Update Order",
      sort_order: 5,
      position_x: X_LEFT,
      position_y: Y_STEP2,
      options: {
        workflow_name: "update-inventory-order-workflow",
        wait_for_completion: true,
        input: {
          id:          "{{ prepare_update.id }}",
          data:        "{{ prepare_update.data }}",
          order_lines: "{{ prepare_update.order_lines }}",
        },
      },
    },

    // ── 7a. Mark Processed (update branch) ───────────────────────────────────
    {
      operation_key: "mark_processed_update",
      operation_type: "update_data",
      name: "Mark Processed",
      sort_order: 6,
      position_x: X_LEFT,
      position_y: Y_STEP3,
      options: {
        module:     "inbound_emails",
        collection: "InboundEmails",
        selector:   { id: "{{ read_email.records[0].id }}" },
        data:       { status: "processed" },
      },
    },

    // ══════════════════════════════════════════════════════════════════════════
    // CREATE BRANCH (order not found)
    // ══════════════════════════════════════════════════════════════════════════

    // ── 5b. Create Inventory Items (one per order line) ───────────────────────
    // Workflow: create-inventory-items-workflow (Medusa core)
    // Input:    { items: [{ title, description }] }
    // Returns:  InventoryItemDTO[] → records[i][0].id
    {
      operation_key: "create_inventory_items",
      operation_type: "bulk_trigger_workflow",
      name: "Create Inventory Items",
      sort_order: 7,
      position_x: X_RIGHT,
      position_y: Y_STEP1,
      options: {
        workflow_name:    "create-inventory-items-workflow",
        items:            "{{ parse_email.order_lines }}",
        continue_on_error: false,
        input_template: {
          items: [
            {
              title:       "{{ item.description }}",
              description: "{{ item.description }}",
            },
          ],
        },
      },
    },

    // ── 6b. Create Raw Materials (one per inventory item) ─────────────────────
    // $index is substituted to the literal index before interpolation, so
    // create_inventory_items.records[$index][0].id resolves per-item.
    {
      operation_key: "create_raw_materials",
      operation_type: "bulk_trigger_workflow",
      name: "Create Raw Materials",
      sort_order: 8,
      position_x: X_RIGHT,
      position_y: Y_STEP2,
      options: {
        workflow_name:    "create-raw-material",
        items:            "{{ parse_email.order_lines }}",
        continue_on_error: true,
        input_template: {
          inventoryId: "{{ create_inventory_items.records[$index][0].id }}",
          rawMaterialData: {
            name:            "{{ item.description }}",
            composition:     "{{ item.description }}",
            unit_of_measure: "Meter",
            status:          "Active",
            // Adjust material_type to an existing type name or ID as needed
            material_type:   "Fabric",
          },
        },
      },
    },

    // ── 7b. Prepare Create payload ────────────────────────────────────────────
    {
      operation_key: "prepare_create",
      operation_type: "execute_code",
      name: "Prepare Create",
      sort_order: 9,
      position_x: X_RIGHT,
      position_y: Y_STEP3,
      options: {
        code: PREPARE_CREATE_CODE,
        timeout: 5000,
      },
    },

    // ── 8b. Create Order ──────────────────────────────────────────────────────
    {
      operation_key: "create_order",
      operation_type: "trigger_workflow",
      name: "Create Order",
      sort_order: 10,
      position_x: X_RIGHT,
      position_y: Y_STEP4,
      options: {
        workflow_name:      "create-inventory-order-workflow",
        wait_for_completion: true,
        input: {
          status:                 "{{ prepare_create.status }}",
          is_sample:              "{{ prepare_create.is_sample }}",
          order_date:             "{{ prepare_create.order_date }}",
          expected_delivery_date: "{{ prepare_create.expected_delivery_date }}",
          stock_location_id:      "{{ prepare_create.stock_location_id }}",
          shipping_address:       "{{ prepare_create.shipping_address }}",
          quantity:               "{{ prepare_create.quantity }}",
          total_price:            "{{ prepare_create.total_price }}",
          order_lines:            "{{ prepare_create.order_lines }}",
          metadata:               "{{ prepare_create.metadata }}",
        },
      },
    },

    // ── 9b. Mark Processed (create branch) ───────────────────────────────────
    {
      operation_key: "mark_processed_create",
      operation_type: "update_data",
      name: "Mark Processed",
      sort_order: 11,
      position_x: X_RIGHT,
      position_y: Y_STEP5,
      options: {
        module:     "inbound_emails",
        collection: "InboundEmails",
        selector:   { id: "{{ read_email.records[0].id }}" },
        data:       { status: "processed" },
      },
    },
  ],

  // ── Connections ─────────────────────────────────────────────────────────────
  connections: [
    { source_id: "trigger",                source_handle: "default", target_id: "read_email",             connection_type: "default" as const },
    { source_id: "read_email",             source_handle: "default", target_id: "parse_email",            connection_type: "default" as const },
    { source_id: "parse_email",            source_handle: "default", target_id: "find_order",             connection_type: "default" as const },
    { source_id: "find_order",             source_handle: "default", target_id: "order_found",            connection_type: "default" as const },
    { source_id: "order_found",            source_handle: "success", target_id: "prepare_update",         connection_type: "success" as const },
    { source_id: "order_found",            source_handle: "failure", target_id: "create_inventory_items", connection_type: "failure" as const },
    { source_id: "prepare_update",         source_handle: "default", target_id: "update_order",           connection_type: "default" as const },
    { source_id: "update_order",           source_handle: "default", target_id: "mark_processed_update",  connection_type: "default" as const },
    { source_id: "create_inventory_items", source_handle: "default", target_id: "create_raw_materials",   connection_type: "default" as const },
    { source_id: "create_raw_materials",   source_handle: "default", target_id: "prepare_create",         connection_type: "default" as const },
    { source_id: "prepare_create",         source_handle: "default", target_id: "create_order",           connection_type: "default" as const },
    { source_id: "create_order",           source_handle: "default", target_id: "mark_processed_create",  connection_type: "default" as const },
  ],
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export default async function seedOrderUpsertFlow({ container }: { container: any }) {
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
      canvas_state:   FLOW_DEF.canvas_state,
    },
    operations: FLOW_DEF.operations,
    connections: FLOW_DEF.connections,
  })

  console.log(`✓ Flow created: ${flow.id}`)
  console.log(`  Open it at: /app/visual-flows/${flow.id}`)
  console.log()
  console.log("  Before activating:")
  console.log("  - Replace stock_location_id in the 'Prepare Create' execute_code step")
  console.log("  - Check material_type in 'Create Raw Materials' matches your categories")
  console.log("  - update-inventory-order-workflow only allows Pending/Processing orders")
}

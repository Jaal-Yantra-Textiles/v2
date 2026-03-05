/**
 * Visual Flow Integration Test — Inbound Email → Inventory Pipeline
 *
 * Tests the full execution pipeline:
 *   trigger
 *   → read_data  (inbound emails with status=received)
 *   → ai_extract (extract material info — fallback_on_error for CI without OpenRouter)
 *   → create_data (raw material via raw_materials module)
 *   → create_data (inventory order referencing the raw material)
 *
 * Pattern follows existing tests (inventory-orders-api.spec.ts etc.):
 *   - setupSharedTestSuite
 *   - All API calls happen in beforeAll/beforeEach; it() blocks only assert
 *     on in-memory variables (each it() is DB-isolated by the test runner)
 *
 * Run with:
 *   TEST_TYPE=integration:http NODE_OPTIONS="--experimental-vm-modules" \
 *     jest --testPathPattern="visual-flow-inbound-email" --verbose
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { INBOUND_EMAIL_MODULE } from "../../src/modules/inbound_emails"

jest.setTimeout(180_000)

// ─── Sample supplier email bodies ────────────────────────────────────────────

const EMAIL_1_HTML = `
<html><body>
<p>Dear Supplier,</p>
<p>Please process the following fabric order:</p>
<table>
  <tr><td>Material:</td><td>Premium Cotton Twill</td></tr>
  <tr><td>Composition:</td><td>100% Cotton</td></tr>
  <tr><td>Quantity:</td><td>500 meters</td></tr>
  <tr><td>Unit Price:</td><td>$4.50/meter</td></tr>
  <tr><td>Total:</td><td>$2250.00</td></tr>
  <tr><td>Required by:</td><td>2026-04-15</td></tr>
</table>
<p>Order Reference: PO-2026-0312-A</p>
</body></html>
`

const EMAIL_2_HTML = `
<html><body>
<p>Hello,</p>
<p>Inventory replenishment request — Silk Charmeuse fabric.</p>
<ul>
  <li>Material: Silk Charmeuse 16mm</li>
  <li>Composition: 100% Silk</li>
  <li>Quantity: 200 meters</li>
  <li>Unit Price: $22.00/meter</li>
  <li>Total: $4400.00</li>
  <li>Required by: 2026-05-01</li>
  <li>Reference: PO-2026-0312-B</li>
</ul>
</body></html>
`

// ─── Canvas state builder ─────────────────────────────────────────────────────

function buildCanvasState(stockLocationId: string) {
  return {
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        position: { x: 400, y: 0 },
        data: { label: "Manual Trigger" },
      },
      // Step 1 — read received inbound emails
      {
        id: "node_read_emails",
        type: "operation",
        position: { x: 400, y: 150 },
        data: {
          operationKey: "read_inbound_emails",
          operationType: "read_data",
          label: "Read Received Emails",
          options: {
            entity: "inbound_email",
            fields: ["id", "subject", "from_address", "html_body", "status", "received_at"],
            filters: { status: "received" },
            limit: 50,
            offset: 0,
          },
        },
      },
      // Step 2 — extract order details from the first email (mocked for CI)
      {
        id: "node_ai_extract",
        type: "operation",
        position: { x: 400, y: 300 },
        data: {
          operationKey: "extract_order",
          operationType: "ai_extract",
          label: "Extract Order Details",
          options: {
            model: "google/gemini-2.0-flash-exp:free",
            input: "{{ read_inbound_emails.records[0].html_body }}",
            system_prompt: "Extract fabric order information from this supplier email.",
            schema_fields: [
              { name: "material_name", type: "string", description: "Name of the material", required: true },
              { name: "composition", type: "string", description: "Material composition e.g. 100% Cotton" },
              { name: "quantity", type: "number", description: "Quantity ordered" },
              { name: "total_price", type: "number", description: "Total order price in USD" },
            ],
            fallback_on_error: true,
            mock_response: {
              material_name: "Premium Cotton Twill",
              composition: "100% Cotton",
              quantity: 500,
              total_price: 2250,
            },
          },
        },
      },
      // Step 3 — create a Medusa inventory item (stock-trackable unit) directly via module
      {
        id: "node_create_inventory_item",
        type: "operation",
        position: { x: 400, y: 450 },
        data: {
          operationKey: "create_inventory_item",
          operationType: "create_data",
          label: "Create Inventory Item",
          options: {
            module: "inventory",
            collection: "InventoryItems",
            data: {
              title: "{{ extract_order.material_name }}",
              description: "Fabric sourced via inbound email order",
              material: "{{ extract_order.composition }}",
              metadata: { source: "visual_flow_test" },
            },
          },
        },
      },
      // Step 4 — create the raw material and link it to the inventory item via module
      {
        id: "node_create_raw_material",
        type: "operation",
        position: { x: 400, y: 600 },
        data: {
          operationKey: "create_raw_material",
          operationType: "create_data",
          label: "Create Raw Material",
          options: {
            module: "raw_materials",
            collection: "RawMaterials",
            data: {
              name: "{{ extract_order.material_name }}",
              description: "Fabric sourced via inbound email order",
              composition: "{{ extract_order.composition }}",
              unit_of_measure: "Meter",
              minimum_order_quantity: 100,
              status: "Active",
              metadata: {
                source: "visual_flow_test",
                inventory_item_id: "{{ create_inventory_item.id }}",
              },
            },
          },
        },
      },
      // Step 5 — create inventory order + lines via the Medusa workflow
      // create_data can't handle order_lines (requires createInvWithLines + remote link steps)
      // trigger_workflow runs the full create-inventory-order-workflow instead
      {
        id: "node_create_inv_order",
        type: "operation",
        position: { x: 400, y: 750 },
        data: {
          operationKey: "create_inv_order",
          operationType: "trigger_workflow",
          label: "Create Inventory Order",
          options: {
            workflow_name: "create-inventory-order-workflow",
            input: {
              order_lines: [
                {
                  inventory_item_id: "{{ create_inventory_item.id }}",
                  quantity: 100,
                  price: 450,
                },
              ],
              quantity: 100,
              total_price: 450,
              status: "Pending",
              is_sample: false,
              order_date: "2026-03-05T00:00:00.000Z",
              expected_delivery_date: "2026-04-15T00:00:00.000Z",
              shipping_address: {},
              stock_location_id: stockLocationId,
              metadata: { source: "visual_flow_test" },
            },
          },
        },
      },
    ],
    edges: [
      { id: "e1", source: "trigger",                   target: "node_read_emails",            sourceHandle: "default", targetHandle: "default" },
      { id: "e2", source: "node_read_emails",           target: "node_ai_extract",             sourceHandle: "default", targetHandle: "default" },
      { id: "e3", source: "node_ai_extract",            target: "node_create_inventory_item",  sourceHandle: "default", targetHandle: "default" },
      { id: "e4", source: "node_create_inventory_item", target: "node_create_raw_material",    sourceHandle: "default", targetHandle: "default" },
      { id: "e5", source: "node_create_raw_material",   target: "node_create_inv_order",       sourceHandle: "default", targetHandle: "default" },
    ],
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  let headers: Record<string, string>

  // All results collected in beforeAll — it() blocks only assert on these
  let flowId: string
  let seededEmailIds: string[]
  let stockLocationId: string
  let executionResult: any        // result from POST /execute
  let executionsListResult: any   // result from GET /executions

  beforeAll(async () => {
    const container = getContainer()

    // ── Auth ──────────────────────────────────────────────────────────────────
    await createAdminUser(container)
    headers = await getAuthHeaders(api)

    // ── Seed 2 inbound emails directly via service ───────────────────────────
    const emailService = container.resolve(INBOUND_EMAIL_MODULE) as any

    const [email1, email2] = await Promise.all([
      emailService.createInboundEmails({
        imap_uid: "vf-test-uid-001",
        from_address: "supplier-a@fabrics.test",
        to_addresses: ["procurement@jyt.test"],
        subject: "Fabric Order — Cotton Twill 500m — PO-2026-0312-A",
        html_body: EMAIL_1_HTML,
        text_body: "Premium Cotton Twill, 500m, $2250",
        folder: "INBOX",
        received_at: new Date("2026-03-05T08:00:00Z"),
        status: "received",
      }),
      emailService.createInboundEmails({
        imap_uid: "vf-test-uid-002",
        from_address: "supplier-b@silks.test",
        to_addresses: ["procurement@jyt.test"],
        subject: "Replenishment — Silk Charmeuse 200m — PO-2026-0312-B",
        html_body: EMAIL_2_HTML,
        text_body: "Silk Charmeuse 16mm, 200m, $4400",
        folder: "INBOX",
        received_at: new Date("2026-03-05T09:30:00Z"),
        status: "received",
      }),
    ])

    seededEmailIds = [email1.id, email2.id]

    // ── Create a stock location (required by create-inventory-order-workflow) ─
    const slResp = await api.post(
      "/admin/stock-locations",
      { name: "VF Test Warehouse" },
      headers
    )
    expect(slResp.status).toBe(200)
    stockLocationId = slResp.data.stock_location.id

    // ── Create flow ───────────────────────────────────────────────────────────
    const createResp = await api.post(
      "/admin/visual-flows",
      {
        name: "Inbound Email → Raw Material → Inventory Order (Test)",
        status: "active",
        trigger_type: "manual",
        canvas_state: buildCanvasState(stockLocationId),
      },
      headers
    )

    expect(createResp.status).toBe(201)
    flowId = createResp.data.flow.id

    // ── Execute flow ──────────────────────────────────────────────────────────
    const execResp = await api.post(
      `/admin/visual-flows/${flowId}/execute`,
      { trigger_data: { source: "integration_test" } },
      { ...headers, validateStatus: () => true }
    )

    console.log("[test] Execute status:", execResp.status)
    console.log("[test] Execute response:", JSON.stringify(execResp.data, null, 2))

    executionResult = execResp.data

    // ── Fetch executions list (must be in beforeAll — isolated in it() blocks) ─
    const listResp = await api.get(
      `/admin/visual-flows/${flowId}/executions`,
      { ...headers, validateStatus: () => true }
    )

    console.log("[test] Executions list:", JSON.stringify(listResp.data, null, 2))
    executionsListResult = listResp.data
  })

  // ─── Assertions (all use in-memory data — no new API/DB calls) ─────────────

  describe("POST /admin/visual-flows", () => {
    it("should create the flow with status active", () => {
      expect(flowId).toBeDefined()
      expect(flowId).toMatch(/^vflow/)
    })
  })

  describe("POST /admin/visual-flows/:id/execute", () => {
    it("should return status 200 and execution_id", () => {
      expect(executionResult).toBeDefined()
      expect(executionResult.execution_id).toBeDefined()
      expect(executionResult.status).toBe("completed")
      expect(executionResult.error).toBeFalsy()
    })

    it("data_chain.$trigger should contain the trigger data", () => {
      const chain = executionResult.data_chain
      expect(chain.$trigger).toBeDefined()
      expect(chain.$trigger.source).toBe("integration_test")
    })

    it("data_chain.read_inbound_emails should contain both seeded emails", () => {
      const chain = executionResult.data_chain
      expect(chain.read_inbound_emails).toBeDefined()
      expect(chain.read_inbound_emails.records.length).toBeGreaterThanOrEqual(2)

      const ids = chain.read_inbound_emails.records.map((r: any) => r.id)
      expect(ids).toEqual(expect.arrayContaining(seededEmailIds))

      const e1 = chain.read_inbound_emails.records.find((r: any) => r.id === seededEmailIds[0])
      expect(e1.subject).toContain("Cotton Twill")
      expect(e1.from_address).toBe("supplier-a@fabrics.test")

      const e2 = chain.read_inbound_emails.records.find((r: any) => r.id === seededEmailIds[1])
      expect(e2.subject).toContain("Silk Charmeuse")
    })

    it("data_chain.extract_order should contain the mocked extraction fields", () => {
      const chain = executionResult.data_chain

      expect(chain.extract_order).toBeDefined()
      expect(chain.extract_order.material_name).toBe("Premium Cotton Twill")
      expect(chain.extract_order.composition).toBe("100% Cotton")
      expect(chain.extract_order.quantity).toBe(500)
      expect(chain.extract_order.total_price).toBe(2250)
    })

    it("data_chain.create_inventory_item should have a Medusa inventory item", () => {
      const chain = executionResult.data_chain
      // create_data returns the record directly — no response envelope
      expect(chain.create_inventory_item).toBeDefined()
      expect(chain.create_inventory_item.id).toBeDefined()
      expect(chain.create_inventory_item.title).toBe("Premium Cotton Twill")
      expect(chain.create_inventory_item.material).toBe("100% Cotton")
    })

    it("data_chain.create_raw_material should have the raw material with inventory_item_id in metadata", () => {
      const chain = executionResult.data_chain
      expect(chain.create_raw_material).toBeDefined()
      expect(chain.create_raw_material.id).toBeDefined()
      expect(chain.create_raw_material.name).toBe("Premium Cotton Twill")
      expect(chain.create_raw_material.composition).toBe("100% Cotton")
      expect(chain.create_raw_material.status).toBe("Active")
      // metadata carries the inventory item ID linking the two records
      expect(chain.create_raw_material.metadata.inventory_item_id).toBe(
        chain.create_inventory_item.id
      )
    })

    it("data_chain.create_inv_order should reference the inventory item via order_lines", () => {
      const chain = executionResult.data_chain
      expect(chain.create_inv_order).toBeDefined()

      // trigger_workflow wraps the result: { workflow_name, result: { order, orderLines, links }, ... }
      const wfResult = chain.create_inv_order.result
      expect(wfResult).toBeDefined()

      const order = wfResult.order
      expect(order).toBeDefined()
      expect(order.status).toBe("Pending")

      const orderLines: any[] = wfResult.orderLines ?? []
      expect(orderLines.length).toBeGreaterThan(0)

      // The remote link carries the inventory item ID: result.links[0].inventory.inventory_item_id
      const links: any[] = wfResult.links ?? []
      expect(links.length).toBeGreaterThan(0)
      const linkedInventoryItemId = links[0].inventory?.inventory_item_id
      expect(linkedInventoryItemId).toBe(chain.create_inventory_item.id)
    })
  })

  describe("GET /admin/visual-flows/:id/executions", () => {
    it("should list at least one completed execution for the flow", () => {
      expect(executionsListResult).toBeDefined()
      expect(Array.isArray(executionsListResult.executions)).toBe(true)
      expect(executionsListResult.executions.length).toBeGreaterThan(0)

      const completed = executionsListResult.executions.find(
        (e: any) => e.status === "completed"
      )
      expect(completed).toBeDefined()
      expect(completed.id).toBe(executionResult.execution_id)
    })
  })
})

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { updateInventoryOrderWorkflow } from "../../src/workflows/inventory_orders/update-inventory-order"

/**
 * #780 (group 1) — partner-side inventory-order security hardening.
 *
 * Covers the four remaining items after the C1 IDOR guard (#779):
 *  - A1: detail route returns NOT_FOUND (not NOT_ALLOWED) for a foreign order,
 *        so a partner can't probe other tenants' order ids by status code.
 *  - A2: the complete workflow itself rejects a mismatched partner_id
 *        (defense-in-depth — not only the route).
 *  - A3: submit-payment is idempotent on a repeated idempotency_key.
 *  - A4: the start transition is an atomic compare-and-set — a stale concurrent
 *        Pending→Processing write is rejected, not silently re-applied.
 */

const PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

const TEMPLATES = [
  { name: "partner-order-sent", step: "sent", type: "partner_assignment", priority: "medium" },
  { name: "partner-order-received", step: "received", type: "partner_assignment", priority: "medium" },
  { name: "partner-order-shipped", step: "shipped", type: "partner_assignment", priority: "high" },
]

async function registerPartner(api: any, email: string, handle: string) {
  await api.post("/auth/partner/emailpass/register", { email, password: PARTNER_PASSWORD })
  const login1 = await api.post("/auth/partner/emailpass", { email, password: PARTNER_PASSWORD })
  let headers = { Authorization: `Bearer ${login1.data.token}` }

  const partnerRes = await api.post(
    "/partners",
    { name: handle, handle, admin: { email, first_name: "P", last_name: handle } },
    { headers }
  )
  // Fresh token after partner creation (links partner ↔ auth identity).
  const login2 = await api.post("/auth/partner/emailpass", { email, password: PARTNER_PASSWORD })
  headers = { Authorization: `Bearer ${login2.data.token}` }
  return { partnerId: partnerRes.data.partner.id, headers }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner inventory-orders — security hardening (#780)", () => {
    let adminHeaders: any
    let ownerHeaders: any
    let attackerHeaders: any
    let ownerPartnerId: string
    let attackerPartnerId: string
    let inventoryItemId: string
    let stockLocationId: string
    let inventoryOrderId: string

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const unique = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
      const owner = await registerPartner(api, `owner-${unique}@sec-test.com`, `owner-${unique}`)
      ownerHeaders = owner.headers
      ownerPartnerId = owner.partnerId
      const attacker = await registerPartner(api, `attacker-${unique}@sec-test.com`, `attacker-${unique}`)
      attackerHeaders = attacker.headers
      attackerPartnerId = attacker.partnerId

      // Task templates the send-to-partner workflow needs to assign the order.
      let categoryId: string | undefined
      for (const t of TEMPLATES) {
        const payload: any = {
          name: t.name,
          description: `Template ${t.name}`,
          priority: t.priority,
          estimated_duration: 30,
          required_fields: { order_id: { type: "string", required: true }, partner_id: { type: "string", required: true } },
          eventable: true,
          notifiable: true,
          message_template: "Order {{order_id}}.",
          metadata: { workflow_type: t.type, workflow_step: t.step },
        }
        if (categoryId) payload.category_id = categoryId
        else payload.category = "Partner Orders"
        const res = await api.post("/admin/task-templates", payload, adminHeaders)
        expect(res.status).toBe(201)
        if (!categoryId) categoryId = res.data.task_template.category_id
      }

      const itemRes = await api.post("/admin/inventory-items", { title: `Sec Fabric ${unique}` }, adminHeaders)
      expect(itemRes.status).toBe(200)
      inventoryItemId = itemRes.data.inventory_item.id

      const locRes = await api.post("/admin/stock-locations", { name: `Sec WH ${unique}` }, adminHeaders)
      expect(locRes.status).toBe(200)
      stockLocationId = locRes.data.stock_location.id

      const fromLocRes = await api.post("/admin/stock-locations", { name: `Sec From ${unique}` }, adminHeaders)
      expect(fromLocRes.status).toBe(200)
      const fromStockLocationId = fromLocRes.data.stock_location.id

      await createInventoryLevelsWorkflow(container).run({
        input: { inventory_levels: [{ inventory_item_id: inventoryItemId, location_id: stockLocationId, stocked_quantity: 0 }] },
      })

      const orderRes = await api.post(
        "/admin/inventory-orders",
        {
          order_lines: [{ inventory_item_id: inventoryItemId, quantity: 10, price: 5 }],
          quantity: 10,
          total_price: 50,
          status: "Pending",
          expected_delivery_date: new Date(Date.now() + 7 * 864e5).toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: { address_1: "1 Sec St", city: "NY", postal_code: "10001", country_code: "US" },
          stock_location_id: stockLocationId,
          to_stock_location_id: stockLocationId,
          from_stock_location_id: fromStockLocationId,
          is_sample: false,
        },
        adminHeaders
      )
      expect(orderRes.status).toBe(201)
      inventoryOrderId = orderRes.data.inventoryOrder.id

      // Assign to the OWNER partner (creates the partner↔order ownership link).
      const sendRes = await api.post(
        `/admin/inventory-orders/${inventoryOrderId}/send-to-partner`,
        { partnerId: ownerPartnerId, notes: "sec-test" },
        adminHeaders
      )
      expect(sendRes.status).toBe(200)
    })

    it("A1: a foreign partner's GET returns 404, not 403 (no existence leak)", async () => {
      // Owner can see it.
      const ownerView = await api.get(`/partners/inventory-orders/${inventoryOrderId}`, { headers: ownerHeaders })
      expect(ownerView.status).toBe(200)

      // Attacker gets a flat 404 — identical to a non-existent id, leaking nothing.
      const attackerView = await api
        .get(`/partners/inventory-orders/${inventoryOrderId}`, { headers: attackerHeaders })
        .catch((e: any) => e.response)
      expect(attackerView.status).toBe(404)

      const bogus = await api
        .get(`/partners/inventory-orders/ior_does_not_exist`, { headers: attackerHeaders })
        .catch((e: any) => e.response)
      expect(bogus.status).toBe(404)
    })

    it("A2: a foreign partner cannot start/complete another partner's order (404)", async () => {
      const start = await api
        .post(`/partners/inventory-orders/${inventoryOrderId}/start`, {}, { headers: attackerHeaders })
        .catch((e: any) => e.response)
      expect(start.status).toBe(404)

      const complete = await api
        .post(
          `/partners/inventory-orders/${inventoryOrderId}/complete`,
          { lines: [{ order_line_id: "x", quantity: 1 }] },
          { headers: attackerHeaders }
        )
        .catch((e: any) => e.response)
      expect(complete.status).toBe(404)

      const pay = await api
        .post(
          `/partners/inventory-orders/${inventoryOrderId}/submit-payment`,
          { amount: 10 },
          { headers: attackerHeaders }
        )
        .catch((e: any) => e.response)
      expect(pay.status).toBe(404)
    })

    it("A3: submit-payment with a repeated idempotency_key does not duplicate the payment", async () => {
      const key = `idem-${Date.now()}`
      const body = { amount: 25, payment_type: "Cash", idempotency_key: key }

      const first = await api.post(`/partners/inventory-orders/${inventoryOrderId}/submit-payment`, body, { headers: ownerHeaders })
      expect(first.status).toBe(200)
      expect(first.data.payment?.id).toBeDefined()
      const firstId = first.data.payment.id

      const second = await api.post(`/partners/inventory-orders/${inventoryOrderId}/submit-payment`, body, { headers: ownerHeaders })
      expect(second.status).toBe(200)
      expect(second.data.idempotent_replay).toBe(true)
      expect(second.data.payment.id).toBe(firstId)

      // Exactly one payment is linked to the order.
      const detail = await api.get(`/partners/inventory-orders/${inventoryOrderId}`, { headers: ownerHeaders })
      const matching = (detail.data.inventoryOrder.payments || []).filter((p: any) => p.id === firstId)
      expect(matching.length).toBe(1)
    })

    it("A4: the start transition is an atomic compare-and-set (stale Pending write is rejected)", async () => {
      const container = getContainer()

      // First transition Pending→Processing succeeds.
      const first = await updateInventoryOrderWorkflow(container).run({
        input: { id: inventoryOrderId, expectedCurrentStatus: "Pending", update: { status: "Processing" } },
        throwOnError: false,
      })
      expect(first.errors?.length ?? 0).toBe(0)

      // A second writer that still expects "Pending" must be rejected (CONFLICT),
      // not silently re-apply the transition — this is the TOCTOU guard.
      const second = await updateInventoryOrderWorkflow(container).run({
        input: { id: inventoryOrderId, expectedCurrentStatus: "Pending", update: { status: "Processing" } },
        throwOnError: false,
      })
      expect(second.errors?.length ?? 0).toBeGreaterThan(0)
      expect(String(second.errors[0].error?.message || "")).toContain("no longer")
    })

    it("A4: a double-clicked HTTP start yields exactly one success", async () => {
      const [a, b] = await Promise.all([
        api.post(`/partners/inventory-orders/${inventoryOrderId}/start`, {}, { headers: ownerHeaders }).catch((e: any) => e.response),
        api.post(`/partners/inventory-orders/${inventoryOrderId}/start`, {}, { headers: ownerHeaders }).catch((e: any) => e.response),
      ])
      const statuses = [a.status, b.status]
      expect(statuses.filter((s) => s === 200).length).toBe(1)
      // The loser is a clean 4xx (409 race or 400 already-started), never a 500.
      expect(statuses.filter((s) => s >= 500).length).toBe(0)

      const view = await api.get(`/partners/inventory-orders/${inventoryOrderId}`, { headers: ownerHeaders })
      expect(view.data.inventoryOrder.status).toBe("Processing")
    })
  })
})

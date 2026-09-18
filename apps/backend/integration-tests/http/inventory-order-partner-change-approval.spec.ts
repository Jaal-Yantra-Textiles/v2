/**
 * Partner-proposed inventory-order changes + admin approval (#1752).
 *
 * A partner can stage line edits/removals and a `tax` charge on an assigned
 * order BEFORE it ships. Nothing reaches the real line/charge tables until an
 * admin approves the proposal (post-ship), at which point the payable ceiling
 * moves. Pins the whole contract:
 *
 *   1. Stage: edits/removals + tax land as a PENDING change, the real lines and
 *      charges are untouched, and the payable ceiling does not move.
 *   2. Approve: lines are applied (edit + removal), the tax becomes a real
 *      charge, and `payable_ceiling` rises by exactly the tax.
 *   3. Ownership: a foreign partner gets 404, not 400/403 (no existence leak).
 *   4. Editable gate: a partner cannot stage edits once the order has shipped.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { ORDER_INVENTORY_MODULE } from "../../src/modules/inventory_orders"

const PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

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
  return {
    partnerId: partnerRes.data.partner.id,
    headers: { Authorization: `Bearer ${login2.data.token}` },
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner inventory-order change proposal + approval (#1752)", () => {
    let adminHeaders: any
    let ownerHeaders: any
    let attackerHeaders: any
    let ownerPartnerId: string
    let itemA: string
    let itemB: string
    let itemC: string
    let orderId: string
    let lineA: any
    let lineB: any
    let lineC: any

    const createItem = async (title: string) => {
      const res = await api.post("/admin/inventory-items", { title, sku: `${title}-${Date.now()}` }, adminHeaders)
      expect(res.status).toBe(200)
      return res.data.inventory_item.id as string
    }

    const fetchLegacyLines = async (id: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_orders",
        filters: { id },
        fields: ["id", "quantity", "total_price", "orderlines.id", "orderlines.quantity", "orderlines.price"],
      })
      return data?.[0]
    }

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const unique = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
      const owner = await registerPartner(api, `owner-${unique}@change-test.com`, `owner-${unique}`)
      ownerHeaders = owner.headers
      ownerPartnerId = owner.partnerId
      const attacker = await registerPartner(api, `attacker-${unique}@change-test.com`, `attacker-${unique}`)
      attackerHeaders = attacker.headers

      itemA = await createItem(`Fabric A ${unique}`)
      itemB = await createItem(`Fabric B ${unique}`)
      itemC = await createItem(`Fabric C ${unique}`)

      const to = await api.post("/admin/stock-locations", { name: `WH ${unique}` }, adminHeaders)
      const from = await api.post("/admin/stock-locations", { name: `From ${unique}` }, adminHeaders)

      const orderRes = await api.post(
        "/admin/inventory-orders",
        {
          order_lines: [
            { inventory_item_id: itemA, quantity: 10, price: 100 },
            { inventory_item_id: itemB, quantity: 5, price: 200 },
            { inventory_item_id: itemC, quantity: 3, price: 50 },
          ],
          quantity: 18,
          total_price: 2150,
          status: "Pending",
          expected_delivery_date: new Date(Date.now() + 7 * 864e5).toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: { address_1: "1 St", city: "NY", postal_code: "10001", country_code: "US" },
          stock_location_id: to.data.stock_location.id,
          to_stock_location_id: to.data.stock_location.id,
          from_stock_location_id: from.data.stock_location.id,
          is_sample: false,
        },
        adminHeaders
      )
      expect(orderRes.status).toBe(201)
      orderId = orderRes.data.inventoryOrder.id
      ;[lineA, lineB, lineC] = orderRes.data.inventoryOrder.orderlines

      const assignRes = await api.post(
        `/admin/inventory-orders/${orderId}/assign-partner`,
        { partner_id: ownerPartnerId },
        adminHeaders
      )
      expect(assignRes.status).toBe(200)
    })

    it("stages edits + removal + tax as a pending change, without applying anything", async () => {
      // Stage: edit A (qty 10 -> 99), keep B, remove C.
      const edit = await api.put(
        `/partners/inventory-orders/${orderId}/order-lines`,
        {
          order_lines: [
            { id: lineA.id, quantity: 99, price: 100 },
            { id: lineB.id, quantity: 5, price: 200 },
            { id: lineC.id, remove: true },
          ],
        },
        { headers: ownerHeaders }
      )
      expect(edit.status).toBe(200)

      const tax = await api.post(
        `/partners/inventory-orders/${orderId}/charges`,
        { type: "tax", amount: 50, note: "GST" },
        { headers: ownerHeaders }
      )
      expect(tax.status).toBe(200)

      // The same single pending change holds both the lines and the charge.
      expect(tax.data.change.id).toBe(edit.data.change.id)
      expect(tax.data.change.status).toBe("pending")
      expect(tax.data.change.proposed_lines).toHaveLength(3)
      expect(tax.data.change.proposed_lines.find((l: any) => l.id === lineC.id).remove).toBe(true)
      expect(tax.data.change.proposed_charges).toEqual([{ type: "tax", amount: 50, note: "GST" }])

      // Nothing applied yet: real lines unchanged, no real charge, ceiling = goods only.
      const after = await fetchLegacyLines(orderId)
      expect(after.orderlines).toHaveLength(3)
      expect(Number(after.orderlines.find((l: any) => l.id === lineA.id).quantity)).toBe(10)

      const charges = await api.get(`/admin/inventory-orders/${orderId}/charges`, adminHeaders)
      expect(charges.data.totals.raises).toBe(0)
      expect(charges.data.payable_ceiling).toBe(2150)
    })

    it("admin approves post-ship: lines applied, tax charge created, ceiling raised", async () => {
      const edit = await api.put(
        `/partners/inventory-orders/${orderId}/order-lines`,
        {
          order_lines: [
            { id: lineA.id, quantity: 99, price: 100 },
            { id: lineB.id, quantity: 5, price: 200 },
            { id: lineC.id, remove: true },
          ],
        },
        { headers: ownerHeaders }
      )
      const changeId = edit.data.change.id
      await api.post(
        `/partners/inventory-orders/${orderId}/charges`,
        { type: "tax", amount: 50 },
        { headers: ownerHeaders }
      )

      const approve = await api.post(
        `/admin/inventory-orders/${orderId}/changes/${changeId}/approve`,
        {},
        adminHeaders
      )
      expect(approve.status).toBe(200)
      expect(approve.data.change.status).toBe("approved")

      // Lines applied: A edited, C removed (2 lines remain).
      const after = await fetchLegacyLines(orderId)
      expect(after.orderlines).toHaveLength(2)
      expect(Number(after.orderlines.find((l: any) => l.id === lineA.id).quantity)).toBe(99)
      expect(after.orderlines.find((l: any) => l.id === lineC.id)).toBeUndefined()
      // Totals re-derived from the approved lines: 99*100 + 5*200 = 10900.
      expect(Number(after.total_price)).toBe(10900)

      // Tax is now a REAL charge, raising the ceiling to 10900 + 50 = 10950.
      const charges = await api.get(`/admin/inventory-orders/${orderId}/charges`, adminHeaders)
      expect(charges.data.totals.raises).toBe(50)
      expect(charges.data.payable_ceiling).toBe(10950)
    })

    /**
     * #2150 — cloth is ordered in METRES. `inventory_order_line.quantity` has
     * been a Postgres `real` since Migration20250821160920, but both validators
     * floored it at 1 whole unit, so a partner correcting a length to 12.5 m
     * got a 400 that blamed their number rather than our rule.
     *
     * Asserted end to end and READ BACK from the row, not from the write's
     * echo: a validator test proves only that zod stopped refusing. What
     * matters is whether Postgres kept the .5, and whether the totals derived
     * from it survive the round trip.
     */
    it("carries a DECIMAL quantity through propose → approve and stores it unrounded", async () => {
      const edit = await api.put(
        `/partners/inventory-orders/${orderId}/order-lines`,
        {
          order_lines: [
            { id: lineA.id, quantity: 12.5, price: 100 },
            { id: lineB.id, quantity: 0.25, price: 200 },
            { id: lineC.id, quantity: 3, price: 50 },
          ],
        },
        { headers: ownerHeaders }
      )
      expect(edit.status).toBe(200)

      const approve = await api.post(
        `/admin/inventory-orders/${orderId}/changes/${edit.data.change.id}/approve`,
        {},
        adminHeaders
      )
      expect(approve.status).toBe(200)

      const after = await fetchLegacyLines(orderId)
      const a = after.orderlines.find((l: any) => l.id === lineA.id)
      const b = after.orderlines.find((l: any) => l.id === lineB.id)
      // The row itself, not the response to the write.
      expect(Number(a.quantity)).toBe(12.5)
      expect(Number(b.quantity)).toBe(0.25)
      // 12.5*100 + 0.25*200 + 3*50 = 1250 + 50 + 150 = 1450.
      expect(Number(after.total_price)).toBe(1450)
    })

    it("refuses a quantity of 0 and points at the removal marker instead", async () => {
      const res = await api
        .put(
          `/partners/inventory-orders/${orderId}/order-lines`,
          { order_lines: [{ id: lineA.id, quantity: 0, price: 100 }] },
          { headers: ownerHeaders }
        )
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
    })

    /**
     * #2150 — `order_lines.min(1)` counts MARKERS, not survivors, so a payload
     * that removes everything passed it. Approval then soft-deleted all three
     * lines: an order with no goods, a derived total of 0 and a payable ceiling
     * of 0, while the partner's screen said only "changes proposed".
     *
     * Refused at STAGING, so the person who made the mistake is still looking
     * at the screen, and nothing is written to the change row.
     */
    it("refuses a proposal that removes EVERY line, and stages nothing", async () => {
      const res = await api
        .put(
          `/partners/inventory-orders/${orderId}/order-lines`,
          {
            order_lines: [
              { id: lineA.id, remove: true },
              { id: lineB.id, remove: true },
              { id: lineC.id, remove: true },
            ],
          },
          { headers: ownerHeaders }
        )
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
      expect(String(res.data?.message)).toContain("removes every line")

      // The order is untouched — the refusal is not a half-write.
      const after = await fetchLegacyLines(orderId)
      expect(after.orderlines).toHaveLength(3)
    })

    it("still allows removing SOME lines — 2 of 3 is an ordinary edit", async () => {
      const res = await api.put(
        `/partners/inventory-orders/${orderId}/order-lines`,
        {
          order_lines: [
            { id: lineA.id, remove: true },
            { id: lineB.id, remove: true },
            { id: lineC.id, quantity: 3, price: 50 },
          ],
        },
        { headers: ownerHeaders }
      )
      expect(res.status).toBe(200)
      expect(
        res.data.change.proposed_lines.filter((l: any) => l.remove)
      ).toHaveLength(2)
    })

    it("a foreign partner cannot stage edits on another partner's order (404, no leak)", async () => {
      const res = await api
        .put(
          `/partners/inventory-orders/${orderId}/order-lines`,
          { order_lines: [{ id: lineA.id, quantity: 1, price: 1 }] },
          { headers: attackerHeaders }
        )
        .catch((e: any) => e.response)
      expect(res.status).toBe(404)
    })

    it("a partner cannot stage edits once the order has shipped", async () => {
      const service: any = getContainer().resolve(ORDER_INVENTORY_MODULE)
      await service.updateInventoryOrders({ selector: { id: orderId }, data: { status: "Shipped" } })

      const res = await api
        .put(
          `/partners/inventory-orders/${orderId}/order-lines`,
          { order_lines: [{ id: lineA.id, quantity: 1, price: 1 }] },
          { headers: ownerHeaders }
        )
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
    })
  })
})
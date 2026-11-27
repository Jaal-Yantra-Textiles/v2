/**
 * #2659 — a partner proposes NEW cloth (and photos) on an assigned inventory
 * order from the mobile app; an admin sorts each new item, then approves.
 *
 * The real case: an order placed with 1 m / ₹0 placeholders because the weaver
 * had not counted yet. Pins:
 *   1. Stage: a `new_material` line (no id) + photos is staged with a server
 *      `key`; nothing is created — no inventory item, no line.
 *   2. Admin sorts: rename one new item, drop another, by key.
 *   3. Approve: the kept new item becomes a real inventory item (title, unit,
 *      thumbnail = first photo) on a new line; the dropped one is never
 *      created; photos on an existing line land on its metadata; totals are
 *      re-derived; no stock is posted.
 *   4. A partner cannot point a new line at an arbitrary existing item.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

const PARTNER_PASSWORD = "supersecret"
const PHOTO_1 = "https://cdn.example.com/matty-1.jpg"
const PHOTO_2 = "https://cdn.example.com/matty-2.jpg"
const LINE_PHOTO = "https://cdn.example.com/beige-check.jpg"

jest.setTimeout(60 * 1000)

async function registerPartner(api: any, email: string, handle: string) {
  await api.post("/auth/partner/emailpass/register", { email, password: PARTNER_PASSWORD })
  const login1 = await api.post("/auth/partner/emailpass", { email, password: PARTNER_PASSWORD })
  const partnerRes = await api.post(
    "/partners",
    { name: handle, handle, admin: { email, first_name: "P", last_name: handle } },
    { headers: { Authorization: `Bearer ${login1.data.token}` } }
  )
  const login2 = await api.post("/auth/partner/emailpass", { email, password: PARTNER_PASSWORD })
  return {
    partnerId: partnerRes.data.partner.id,
    headers: { Authorization: `Bearer ${login2.data.token}` },
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner proposes new items with photos (#2659)", () => {
    let adminHeaders: any
    let ownerHeaders: any
    let orderId: string
    let lineA: any
    let itemA: string
    let destinationId: string

    const readOrder = async (id: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_orders",
        filters: { id },
        fields: [
          "id",
          "quantity",
          "total_price",
          "orderlines.id",
          "orderlines.quantity",
          "orderlines.price",
          "orderlines.metadata",
          "orderlines.inventory_items.id",
          "orderlines.inventory_items.title",
          "orderlines.inventory_items.thumbnail",
          "orderlines.inventory_items.unit_of_measure",
          "orderlines.inventory_items.metadata",
        ],
      })
      return data?.[0]
    }

    const countItemsTitled = async (title: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_item",
        filters: { title },
        fields: ["id"],
      })
      return (data ?? []).length
    }

    beforeEach(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)

      const unique = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
      const owner = await registerPartner(api, `weaver-${unique}@new-items.com`, `weaver-${unique}`)
      ownerHeaders = owner.headers

      const item = await api.post(
        "/admin/inventory-items",
        { title: `Beige check ${unique}`, sku: `beige-${unique}` },
        adminHeaders
      )
      itemA = item.data.inventory_item.id

      const to = await api.post("/admin/stock-locations", { name: `WH ${unique}` }, adminHeaders)
      const from = await api.post("/admin/stock-locations", { name: `Loom ${unique}` }, adminHeaders)
      destinationId = to.data.stock_location.id

      // The real shape: a placeholder line at 1 m / ₹0.
      const orderRes = await api.post(
        "/admin/inventory-orders",
        {
          order_lines: [{ inventory_item_id: itemA, quantity: 1, price: 0 }],
          quantity: 1,
          total_price: 0,
          status: "Pending",
          expected_delivery_date: new Date(Date.now() + 7 * 864e5).toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {},
          stock_location_id: destinationId,
          to_stock_location_id: destinationId,
          from_stock_location_id: from.data.stock_location.id,
          is_sample: false,
        },
        adminHeaders
      )
      expect(orderRes.status).toBe(201)
      orderId = orderRes.data.inventoryOrder.id
      lineA = orderRes.data.inventoryOrder.orderlines[0]

      const assign = await api.post(
        `/admin/inventory-orders/${orderId}/assign-partner`,
        { partner_id: owner.partnerId },
        adminHeaders
      )
      expect(assign.status).toBe(200)
    })

    it("stages new items with photos, admin renames one and drops one, approval creates only the kept item", async () => {
      const unique = orderId.slice(-6)
      const mattyName = `Matty Cotton ${unique}`
      const plainName = `Plain Weave ${unique}`
      const renamed = `Matty Cotton Fine ${unique}`

      const stage = await api.put(
        `/partners/inventory-orders/${orderId}/order-lines`,
        {
          order_lines: [
            { id: lineA.id, quantity: 12.5, price: 180, photos: [LINE_PHOTO] },
            {
              new_material: { name: mattyName, color: "Natural", unit_of_measure: "Meter" },
              quantity: 20,
              price: 150,
              photos: [PHOTO_1, PHOTO_2],
            },
            {
              new_material: { name: plainName },
              quantity: 5,
              price: 100,
            },
          ],
        },
        { headers: ownerHeaders }
      )
      expect(stage.status).toBe(200)
      const change = stage.data.change
      expect(change.status).toBe("pending")
      const newLines = change.proposed_lines.filter((l: any) => !l.id)
      expect(newLines).toHaveLength(2)
      for (const l of newLines) {
        expect(l.key).toMatch(/^npl_/)
      }
      const mattyKey = newLines.find((l: any) => l.new_material.name === mattyName).key
      const plainKey = newLines.find((l: any) => l.new_material.name === plainName).key

      // Staging created nothing.
      const staged = await readOrder(orderId)
      expect(staged.orderlines).toHaveLength(1)
      expect(await countItemsTitled(`${mattyName} — Natural`)).toBe(0)

      // The partner can read their own proposal back, keys and photos included.
      const partnerView = await api.get(`/partners/inventory-orders/${orderId}`, {
        headers: ownerHeaders,
      })
      const pendingLines =
        partnerView.data.inventoryOrder?.pending_change?.proposed_lines ??
        partnerView.data.inventory_order?.pending_change?.proposed_lines
      expect(pendingLines.find((l: any) => l.key === mattyKey).photos).toEqual([PHOTO_1, PHOTO_2])

      // Admin sorts: rename Matty, drop Plain.
      const rename = await api.post(
        `/admin/inventory-orders/${orderId}/changes/${change.id}/new-lines/${mattyKey}`,
        { new_material: { name: renamed } },
        adminHeaders
      )
      expect(rename.status).toBe(200)
      const drop = await api.post(
        `/admin/inventory-orders/${orderId}/changes/${change.id}/new-lines/${plainKey}`,
        { drop: true },
        adminHeaders
      )
      expect(drop.status).toBe(200)
      expect(drop.data.change.proposed_lines.filter((l: any) => !l.id)).toHaveLength(1)

      const missing = await api
        .post(
          `/admin/inventory-orders/${orderId}/changes/${change.id}/new-lines/npl_nope`,
          { drop: true },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(missing.status).toBe(404)

      const approve = await api.post(
        `/admin/inventory-orders/${orderId}/changes/${change.id}/approve`,
        {},
        adminHeaders
      )
      expect(approve.status).toBe(200)

      const after = await readOrder(orderId)
      expect(after.orderlines).toHaveLength(2)

      // The existing line: real quantity/price, and the photo on its metadata.
      const a = after.orderlines.find((l: any) => l.id === lineA.id)
      expect(Number(a.quantity)).toBe(12.5)
      expect(Number(a.price)).toBe(180)
      // A STRING, not an array: the shipped apps decode line metadata as a
      // string map and an array would break the whole order for them.
      expect(a.metadata?.photos).toBe(LINE_PHOTO)

      // The kept new item, created by approval, renamed by the admin.
      const created = after.orderlines.find((l: any) => l.id !== lineA.id)
      const item = created.inventory_items?.[0]
      expect(item?.title).toBe(`${renamed} — Natural`)
      expect(item?.unit_of_measure).toBe("Meter")
      expect(item?.thumbnail).toBe(PHOTO_1)
      expect(item?.metadata?.photos).toEqual([PHOTO_1, PHOTO_2])
      expect(Number(created.quantity)).toBe(20)

      // The dropped one never existed.
      expect(await countItemsTitled(plainName)).toBe(0)

      // Totals from the approved lines: 12.5*180 + 20*150 = 2250 + 3000.
      expect(Number(after.total_price)).toBe(5250)
      expect(Number(after.quantity)).toBe(32.5)

      // No stock posted for the new item at the destination.
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: levels } = await query.graph({
        entity: "inventory_level",
        filters: { inventory_item_id: item.id, location_id: destinationId },
        fields: ["stocked_quantity"],
      })
      expect(levels.reduce((s: number, l: any) => s + Number(l.stocked_quantity || 0), 0)).toBe(0)
    })

    it("refuses a new line that names an existing inventory item, and one with no new_material", async () => {
      const pointAtItem = await api
        .put(
          `/partners/inventory-orders/${orderId}/order-lines`,
          {
            order_lines: [
              { id: lineA.id, quantity: 1, price: 0 },
              { inventory_item_id: itemA, quantity: 5, price: 10 },
            ],
          },
          { headers: ownerHeaders }
        )
        .catch((e: any) => e.response)
      expect(pointAtItem.status).toBe(400)

      const noName = await api
        .put(
          `/partners/inventory-orders/${orderId}/order-lines`,
          { order_lines: [{ quantity: 5, price: 10 }] },
          { headers: ownerHeaders }
        )
        .catch((e: any) => e.response)
      expect(noName.status).toBe(400)

      const badPhoto = await api
        .put(
          `/partners/inventory-orders/${orderId}/order-lines`,
          {
            order_lines: [
              { new_material: { name: "X" }, quantity: 5, price: 10, photos: ["file:///tmp/x.jpg"] },
            ],
          },
          { headers: ownerHeaders }
        )
        .catch((e: any) => e.response)
      expect(badPhoto.status).toBe(400)
    })

    it("lets a partner replace the only listed cloth with new ones (not an emptying)", async () => {
      const stage = await api.put(
        `/partners/inventory-orders/${orderId}/order-lines`,
        {
          order_lines: [
            { id: lineA.id, remove: true },
            { new_material: { name: `Swap ${orderId.slice(-6)}` }, quantity: 3, price: 90 },
          ],
        },
        { headers: ownerHeaders }
      )
      expect(stage.status).toBe(200)
    })
  })
})

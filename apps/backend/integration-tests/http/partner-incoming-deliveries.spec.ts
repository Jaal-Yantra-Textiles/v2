/**
 * #2286 — the RECEIVING partner confirms a delivery, and sees their stock
 * without a store.
 *
 * The prod case: GOF shipped 70.60 m to Ksaman's warehouse; the carrier marked
 * it Delivered; Ksaman has the cloth and no way to say so. Ksaman has no store,
 * so even received stock was invisible to them.
 *
 * The receiver in this spec has NO store — only the typed partner → warehouse
 * link (#2053) — because that is the case that was broken.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ORDER_INVENTORY_MODULE } from "../../src/modules/inventory_orders"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ensureHouseStoreRegion } from "../helpers/ensure-house-store-region"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

const PASSWORD = "supersecret"

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("partner incoming deliveries + store-less stock (#2286)", () => {
    let adminHeaders: any
    let unique: number

    const post = async (url: string, body: any, cfg?: any) => {
      try {
        return await api.post(url, body, cfg)
      } catch (err: any) {
        throw new Error(`POST ${url} failed: ${err?.response?.status} ${JSON.stringify(err?.response?.data)}`)
      }
    }

    const makePartner = async (label: string) => {
      const email = `incoming-${label}-${unique}@jyt.test`
      await post("/auth/partner/emailpass/register", { email, password: PASSWORD })
      const l1 = await post("/auth/partner/emailpass", { email, password: PASSWORD })
      const p = await post(
        "/partners",
        { name: `Incoming ${label} ${unique}`, handle: `incoming-${label}-${unique}`, admin: { email, first_name: "I", last_name: "D" } },
        { headers: { Authorization: `Bearer ${l1.data.token}` } }
      )
      const l2 = await post("/auth/partner/emailpass", { email, password: PASSWORD })
      return { id: p.data.partner.id as string, headers: { headers: { Authorization: `Bearer ${l2.data.token}` } } }
    }

    const makeLocation = async (name: string) =>
      (await post("/admin/stock-locations", { name: `${name} ${unique}` }, adminHeaders)).data.stock_location.id as string

    const linkWarehouse = async (partnerId: string, locationId: string) => {
      const link: any = getContainer().resolve(ContainerRegistrationKeys.LINK)
      await link.create([{ [PARTNER_MODULE]: { partner_id: partnerId }, [Modules.STOCK_LOCATION]: { stock_location_id: locationId } }])
    }

    const makeItem = async (title: string) =>
      (await post("/admin/inventory-items", { title, sku: `${title}-${unique}`.replace(/\s+/g, "-") }, adminHeaders)).data
        .inventory_item.id as string

    const stockAt = async (itemId: string, locationId: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_level",
        fields: ["stocked_quantity"],
        filters: { inventory_item_id: itemId, location_id: locationId },
      })
      return Number(data?.[0]?.stocked_quantity ?? 0)
    }

    /** An order FROM the supplier's warehouse TO the receiver's, marked Shipped. */
    const makeOrder = async (from: string, to: string, lines: Array<{ item: string; qty: number }>) => {
      const res = await post(
        "/admin/inventory-orders",
        {
          order_lines: lines.map((l) => ({ inventory_item_id: l.item, quantity: l.qty, price: 100 })),
          quantity: lines.reduce((s, l) => s + l.qty, 0),
          total_price: lines.reduce((s, l) => s + l.qty * 100, 0),
          status: "Pending",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {},
          stock_location_id: to,
          from_stock_location_id: from,
        },
        adminHeaders
      )
      const order = res.data.inventoryOrder
      return { id: order.id as string, lineIds: (order.orderlines as any[]).map((l) => l.id as string) }
    }

    const setStatus = async (orderId: string, status: string) => {
      const svc: any = getContainer().resolve(ORDER_INVENTORY_MODULE)
      await svc.updateInventoryOrders({ id: orderId, status })
    }

    beforeEach(async () => {
      unique = Date.now()
      await createAdminUser(getContainer())
      await ensureHouseStoreRegion(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    it("a store-less receiver lists the delivery, confirms one line short, and sees the stock", async () => {
      const receiver = await makePartner("recv")
      const supplierWh = await makeLocation("Supplier WH")
      const receiverWh = await makeLocation("Receiver WH")
      await linkWarehouse(receiver.id, receiverWh)

      const silk = await makeItem("Eri Silk")
      const linen = await makeItem("Cotton Linen")
      const order = await makeOrder(supplierWh, receiverWh, [
        { item: silk, qty: 31.6 },
        { item: linen, qty: 11.5 },
      ])

      // Pending: listed, but not confirmable yet — nothing has left the supplier.
      let list = await api.get("/partners/incoming-deliveries", receiver.headers)
      let row = list.data.incoming_deliveries.find((d: any) => d.id === order.id)
      expect(row).toBeTruthy()
      expect(row.can_confirm).toBe(false)
      expect(row.cannot_confirm_reason).toBe("not_dispatched")
      expect(row.lines.every((l: any) => l.price === undefined)).toBe(true)

      await setStatus(order.id, "Shipped")
      list = await api.get("/partners/incoming-deliveries", receiver.headers)
      row = list.data.incoming_deliveries.find((d: any) => d.id === order.id)
      expect(row.can_confirm).toBe(true)
      expect(row.outstanding).toBeCloseTo(43.1)

      // The partner's count: the linen arrived 0.5 m short.
      const [silkLine, linenLine] = order.lineIds
      const res = await post(
        `/partners/incoming-deliveries/${order.id}/receive`,
        { lines: [{ order_line_id: silkLine, quantity: 31.6 }, { order_line_id: linenLine, quantity: 11 }], notes: "linen short" },
        receiver.headers
      )
      expect(res.status).toBe(200)

      // Stock lands at the RECEIVER's warehouse — never the supplier's.
      expect(await stockAt(silk, receiverWh)).toBeCloseTo(31.6)
      expect(await stockAt(linen, receiverWh)).toBeCloseTo(11)
      expect(await stockAt(silk, supplierWh)).toBe(0)

      // What is still outstanding is the shortfall, and it stays listed.
      list = await api.get("/partners/incoming-deliveries", receiver.headers)
      row = list.data.incoming_deliveries.find((d: any) => d.id === order.id)
      expect(row.lines.find((l: any) => l.id === linenLine).outstanding).toBeCloseTo(0.5)

      // Confirming the silk again is refused, not posted twice.
      const again = await api
        .post(`/partners/incoming-deliveries/${order.id}/receive`, { lines: [{ order_line_id: silkLine, quantity: 31.6 }] }, receiver.headers)
        .catch((e: any) => e.response)
      expect(again.status).toBe(400)
      expect(await stockAt(silk, receiverWh)).toBeCloseTo(31.6)

      // The store-less receiver SEES the stock on their inventory screen.
      const inv = await api.get("/partners/inventory-items?limit=50", receiver.headers)
      const ids = (inv.data.inventory_items || []).map((i: any) => i.id)
      expect(ids).toEqual(expect.arrayContaining([silk, linen]))

      // The timeline names the partner, not an admin.
      const svc: any = getContainer().resolve(ORDER_INVENTORY_MODULE)
      const acts = await svc.listInventoryOrderActivities({ inventory_order_id: order.id, kind: "goods_received" })
      expect(acts[0]?.actor_type).toBe("partner")
      expect(acts[0]?.partner_id).toBe(receiver.id)
    })

    it("another partner can neither see nor confirm the delivery", async () => {
      const receiver = await makePartner("owner")
      const other = await makePartner("other")
      const supplierWh = await makeLocation("Sup")
      const receiverWh = await makeLocation("Own")
      const otherWh = await makeLocation("Other")
      await linkWarehouse(receiver.id, receiverWh)
      await linkWarehouse(other.id, otherWh)
      const item = await makeItem("Hemp Silk")
      const order = await makeOrder(supplierWh, receiverWh, [{ item, qty: 16 }])
      await setStatus(order.id, "Shipped")

      const list = await api.get("/partners/incoming-deliveries", other.headers)
      expect(list.data.incoming_deliveries.map((d: any) => d.id)).not.toContain(order.id)
      const denied = await api
        .post(`/partners/incoming-deliveries/${order.id}/receive`, { lines: [{ order_line_id: order.lineIds[0], quantity: 16 }] }, other.headers)
        .catch((e: any) => e.response)
      expect(denied.status).toBe(404)
      expect(await stockAt(item, otherWh)).toBe(0)
      expect(await stockAt(item, receiverWh)).toBe(0)
    })

    it("a SUPPLIER's Complete posts NO stock; the receiver's count does, at the destination (#2289)", async () => {
      // Founder decision 2026-10-08: a supplier's Complete records a dispatch.
      // Only a receiver's count posts stock, so a lower count can be recorded.
      for (const name of ["partner-order-sent", "partner-order-received", "partner-order-shipped"]) {
        await post(
          "/admin/task-templates",
          {
            name,
            description: `${name} template`,
            priority: "medium",
            estimated_duration: 30,
            eventable: true,
            notifiable: true,
            metadata: { workflow_type: "partner_assignment" },
          },
          adminHeaders
        )
      }
      const supplier = await makePartner("supplier")
      const supplierWh = await makeLocation("Supplier Own")
      const destWh = await makeLocation("Receiver Own")
      const item = await makeItem("Linen Scarf")
      const order = await makeOrder(supplierWh, destWh, [{ item, qty: 10 }])

      await post(`/admin/inventory-orders/${order.id}/send-to-partner`, { partnerId: supplier.id, notes: "#2286" }, adminHeaders)
      await post(`/partners/inventory-orders/${order.id}/start`, {}, supplier.headers)
      const done = await post(
        `/partners/inventory-orders/${order.id}/complete`,
        { lines: [{ order_line_id: order.lineIds[0], quantity: 10 }] },
        supplier.headers
      )
      expect(done.status).toBe(200)

      // The supplier's word moves nothing.
      expect(await stockAt(item, destWh)).toBe(0)
      expect(await stockAt(item, supplierWh)).toBe(0)
      const afterDispatch = await api.get(`/partners/inventory-orders/${order.id}`, supplier.headers)
      expect(afterDispatch.data.inventoryOrder.order_lines[0].ledger).toEqual(
        expect.objectContaining({ dispatched: 10, received: 0, to_dispatch: 0, awaiting_count: 10 })
      )

      // #2289 S2 — the admin's "awaiting count" list shows it, at its destination.
      const waiting = await api.get(`/admin/inventory-orders/awaiting-count?destination_location_id=${destWh}`, adminHeaders)
      expect(waiting.status).toBe(200)
      const listed = waiting.data.orders.find((o: any) => o.id === order.id)
      expect(listed).toEqual(
        expect.objectContaining({ destination_location_id: destWh, awaiting_quantity: 10, partner_id: supplier.id })
      )

      // 🔴 Before #2289 this was impossible: the Complete had already written
      // 10 as received, so a count of 9 failed "Nothing outstanding".
      const counted = await post(
        `/admin/inventory-orders/${order.id}/receive`,
        { lines: [{ order_line_id: order.lineIds[0], quantity: 9 }] },
        adminHeaders
      )
      expect(counted.status).toBe(200)
      expect(await stockAt(item, destWh)).toBe(9)
      expect(await stockAt(item, supplierWh)).toBe(0)
      const afterCount = await api.get(`/partners/inventory-orders/${order.id}`, supplier.headers)
      // #2289 S3 — counted 9 of 10 sent: 1 is SHORT, not awaiting, and the
      // supplier sees it.
      expect(afterCount.data.inventoryOrder.order_lines[0].ledger).toEqual(
        expect.objectContaining({ dispatched: 10, received: 9, short: 1, awaiting_count: 0 })
      )
      const after = await api.get(`/admin/inventory-orders/awaiting-count`, adminHeaders)
      expect(after.data.orders.map((o: any) => o.id)).not.toContain(order.id)

      // The admin sees the shortfall, and our team has a task for it.
      const adminView = await api.get(`/admin/inventory-orders/${order.id}`, adminHeaders)
      const shortfalls = adminView.data.inventoryOrder.shortfalls
      expect(shortfalls).toEqual([
        expect.objectContaining({ quantity: 1, dispatched_quantity: 10, received_quantity: 9, status: "open" }),
      ])
      const tasks = await api.get(`/admin/inventory-orders/${order.id}/tasks`, adminHeaders)
      const taskRows = tasks.data.tasks ?? tasks.data.inventory_order?.tasks ?? tasks.data.inventoryOrder?.tasks ?? []
      expect(JSON.stringify(taskRows)).toMatch(/receipt_shortfall/)

      // Resolving with a note closes it; it does not come back as awaiting.
      const resolved = await post(
        `/admin/inventory-orders/${order.id}/shortfalls/${shortfalls[0].id}/resolve`,
        { note: "Credited 1 m on the next payout" },
        adminHeaders
      )
      expect(resolved.status).toBe(200)
      const final = await api.get(`/partners/inventory-orders/${order.id}`, supplier.headers)
      expect(final.data.inventoryOrder.order_lines[0].ledger).toEqual(
        expect.objectContaining({ short: 0, awaiting_count: 0 })
      )
      const finalList = await api.get(`/admin/inventory-orders/awaiting-count`, adminHeaders)
      expect(finalList.data.orders.map((o: any) => o.id)).not.toContain(order.id)
      // Stock is exactly what was counted.
      expect(await stockAt(item, destWh)).toBe(9)
    })

    it("the SUPPLIER's warehouse is never the destination (the stock_locations[0] bug)", async () => {
      // The admin door, on an order with both ends: goods must land at `to`.
      const supplierWh = await makeLocation("Src")
      const destWh = await makeLocation("Dst")
      const item = await makeItem("Scarf")
      const order = await makeOrder(supplierWh, destWh, [{ item, qty: 10 }])
      await setStatus(order.id, "Delivered")

      const res = await post(`/admin/inventory-orders/${order.id}/receive`, {}, adminHeaders)
      expect(res.status).toBe(200)
      expect(await stockAt(item, destWh)).toBe(10)
      expect(await stockAt(item, supplierWh)).toBe(0)

      // And the supplier's warehouse does not list it as incoming.
      const supplier = await makePartner("sup")
      await linkWarehouse(supplier.id, supplierWh)
      const list = await api.get("/partners/incoming-deliveries?all=true", supplier.headers)
      expect(list.data.incoming_deliveries.map((d: any) => d.id)).not.toContain(order.id)
    })
  })
})

/**
 * #342 Chunk 5 (T3.4) — partner unified panels list filter.
 *
 * GET /partners/orders is `?kind=`-aware, mirroring admin's Chunk 4 contract but
 * scoping work-orders through the D3 `partner ↔ order` link (a partner can serve
 * another partner's store, so sales-channel scoping is wrong for work):
 *   - retail (default) → the partner's sales-channel customer orders, work-orders hidden
 *   - design           → only this partner's design work-orders (→ production_run)
 *   - inventory        → only this partner's raw-material POs   (→ inventory_order)
 *   - all              → retail ∪ this partner's work-orders
 *
 * Cases assert by the SPECIFIC ids created here. Partner-scoping gives natural
 * isolation on the shared DB — another partner's work-orders / another channel's
 * retail orders never appear — but asserting by id keeps it robust regardless.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createOrderWorkflow } from "@medusajs/core-flows"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

const TEST_PARTNER_PASSWORD = "supersecret"

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Orders unification partner list filter (#342 Chunk 5)", () => {
    let adminHeaders: any
    let unique: number
    let inventoryItemId: string
    let stockLocationId: string
    let fromStockLocationId: string

    // The logged-in partner under test.
    let partnerHeaders: any
    let partnerId: string
    let salesChannelId: string
    let regionId: string
    let currencyCode: string

    const post = async (url: string, body: any, cfg?: any) => {
      try {
        return await api.post(url, body, cfg)
      } catch (err: any) {
        throw new Error(
          `POST ${url} failed: ${err?.response?.status} ${JSON.stringify(
            err?.response?.data
          )}`
        )
      }
    }

    // Register a partner admin, create the partner, and stand up a store with a
    // default sales channel + region + location — the scoping context the route
    // reads. Returns a fresh-logged-in header set (a stale token misses the
    // partner context).
    const createPartnerWithStore = async () => {
      const email = `partner-list-${unique}@jyt.test`
      await post("/auth/partner/emailpass/register", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      const login1 = await post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      const headers1 = { headers: { Authorization: `Bearer ${login1.data.token}` } }

      const partnerRes = await post(
        "/partners",
        {
          name: `List Filter Partner ${unique}`,
          handle: `list-filter-${unique}`,
          admin: { email, first_name: "List", last_name: "Filter" },
        },
        headers1
      )
      const pid = partnerRes.data.partner.id

      const login2 = await post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      const headers2 = { headers: { Authorization: `Bearer ${login2.data.token}` } }

      const currenciesRes = await api.get("/admin/currencies", adminHeaders)
      const currencies = currenciesRes.data.currencies || []
      const inr = currencies.find((c: any) => c.code?.toLowerCase() === "inr")
      const cc = String((inr || currencies[0]).code).toLowerCase()

      const storeRes = await post(
        "/partners/stores",
        {
          store: {
            name: `List Filter Store ${unique}`,
            supported_currencies: [{ currency_code: cc, is_default: true }],
          },
          sales_channel: { name: `List Filter Channel ${unique}`, description: "Default" },
          region: { name: "List Filter Region", currency_code: cc, countries: ["in"] },
          location: {
            name: "List Filter Warehouse",
            address: {
              address_1: "1 Mill Road",
              city: "Jaipur",
              postal_code: "302001",
              country_code: "IN",
            },
          },
        },
        headers2
      )

      partnerHeaders = headers2
      partnerId = pid
      currencyCode = cc
      salesChannelId = storeRes.data.sales_channel?.id
      regionId = storeRes.data.region?.id
    }

    // GET /partners/orders[?kind=], paged wide, returning the set of order ids.
    const listOrderIds = async (kind?: string): Promise<Set<string>> => {
      const q = kind ? `?kind=${kind}&limit=1000` : `?limit=1000`
      const res = await api.get(`/partners/orders${q}`, partnerHeaders)
      expect(res.status).toBe(200)
      return new Set<string>(res.data.orders.map((o: any) => o.id))
    }

    const unifiedIdFromLegacy = async (
      entity: "inventory_orders" | "production_runs",
      id: string
    ): Promise<string> => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity,
        filters: { id },
        fields: ["id", "order.id", "metadata"],
      })
      const row = data?.[0]
      return row?.order?.id ?? row?.metadata?.unified_order_id
    }

    // A customer retail order in the partner's sales channel.
    const createRetailOrder = async (): Promise<string> => {
      const { result } = await createOrderWorkflow(getContainer()).run({
        input: {
          region_id: regionId,
          sales_channel_id: salesChannelId,
          currency_code: currencyCode,
          email: `retail-${unique}@jyt.test`,
          items: [
            { title: "Retail Tee", quantity: 1, unit_price: 500 } as any,
          ],
        } as any,
      })
      return (result as any).id
    }

    // A raw-material PO created by admin and SENT to this partner (the send is
    // what creates the D3 partner↔order link on the unified order).
    const createInventoryWorkOrder = async (): Promise<string> => {
      const res = await post(
        "/admin/inventory-orders",
        {
          order_lines: [
            { inventory_item_id: inventoryItemId, quantity: 3, price: 100 },
          ],
          quantity: 3,
          total_price: 100,
          status: "Pending",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {
            first_name: "JYT",
            address_1: "Mill Road 1",
            city: "Jaipur",
            country_code: "in",
            postal_code: "302001",
          },
          stock_location_id: stockLocationId,
          from_stock_location_id: fromStockLocationId,
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      const invId = res.data.inventoryOrder.id

      const send = await post(
        `/admin/inventory-orders/${invId}/send-to-partner`,
        { partnerId, notes: "Chunk 5 partner-list test" },
        adminHeaders
      )
      expect(send.status).toBe(200)
      return unifiedIdFromLegacy("inventory_orders", invId)
    }

    // A design work-order assigned to this partner — the per-child run is the
    // partner-facing unit and carries the D3 link on its unified order.
    const createDesignWorkOrder = async (): Promise<string> => {
      const design = await post(
        "/admin/designs",
        {
          name: `Chunk5 Design ${unique}`,
          description: "Design for #342 partner-list-filter test",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(design.status).toBe(201)

      // A non-notifiable task template so the dispatch (which writes the D3
      // partner↔order link) doesn't error in the notification path and get
      // swallowed — mirrors orders-unification-design-dual-write.spec.ts.
      const templateName = `partner-list-design-${unique}`
      const tpl = await post(
        "/admin/task-templates",
        {
          name: templateName,
          description: `${templateName} template`,
          priority: "medium",
          estimated_duration: 60,
          required_fields: {},
          eventable: false,
          notifiable: false,
          message_template: "",
          metadata: { workflow_type: "production_run" },
          category: "Partner List Filter Test",
        },
        adminHeaders
      )
      expect([200, 201]).toContain(tpl.status)

      const createRes = await post(
        `/admin/designs/${design.data.design.id}/production-runs`,
        {
          assignments: [
            {
              partner_id: partnerId,
              quantity: 4,
              role: "manufacturing",
              template_names: [templateName],
            },
          ],
        },
        adminHeaders
      )
      expect([200, 201]).toContain(createRes.status)
      const childId =
        createRes.data.children?.[0]?.id ??
        createRes.data.result?.children?.[0]?.id
      expect(childId).toBeTruthy()
      return unifiedIdFromLegacy("production_runs", childId)
    }

    beforeEach(async () => {
      const container = getContainer()
      unique = Date.now()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const inv = await api.post(
        "/admin/inventory-items",
        { title: "Raw Cotton", sku: `RAW-COTTON-${unique}` },
        adminHeaders
      )
      inventoryItemId = inv.data.inventory_item.id

      const to = await api.post(
        "/admin/stock-locations",
        { name: `Main ${unique}` },
        adminHeaders
      )
      stockLocationId = to.data.stock_location.id
      const from = await api.post(
        "/admin/stock-locations",
        { name: `Secondary ${unique}` },
        adminHeaders
      )
      fromStockLocationId = from.data.stock_location.id

      // The inventory send-to-partner workflow creates tasks from these
      // templates and 400s if they're missing.
      for (const name of [
        "partner-order-sent",
        "partner-order-received",
        "partner-order-shipped",
      ]) {
        const tpl = await api.post(
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
        expect([200, 201]).toContain(tpl.status)
      }

      await createPartnerWithStore()
    })

    it("default list shows the partner's retail orders and hides work-orders", async () => {
      const retailId = await createRetailOrder()
      const inventoryId = await createInventoryWorkOrder()
      const designId = await createDesignWorkOrder()

      const ids = await listOrderIds()
      expect(ids.has(retailId)).toBe(true)
      expect(ids.has(inventoryId)).toBe(false)
      expect(ids.has(designId)).toBe(false)

      // ?kind=retail is the explicit form of the default.
      const retailIds = await listOrderIds("retail")
      expect(retailIds.has(retailId)).toBe(true)
      expect(retailIds.has(inventoryId)).toBe(false)
      expect(retailIds.has(designId)).toBe(false)
    })

    it("?kind=inventory surfaces only the partner's raw-material POs", async () => {
      const retailId = await createRetailOrder()
      const inventoryId = await createInventoryWorkOrder()
      const designId = await createDesignWorkOrder()

      const ids = await listOrderIds("inventory")
      expect(ids.has(inventoryId)).toBe(true)
      expect(ids.has(designId)).toBe(false)
      expect(ids.has(retailId)).toBe(false)
    })

    it("?kind=design surfaces only the partner's design work-orders", async () => {
      const retailId = await createRetailOrder()
      const inventoryId = await createInventoryWorkOrder()
      const designId = await createDesignWorkOrder()

      const ids = await listOrderIds("design")
      expect(ids.has(designId)).toBe(true)
      expect(ids.has(inventoryId)).toBe(false)
      expect(ids.has(retailId)).toBe(false)
    })

    it("?kind=all shows the partner's retail orders ∪ work-orders", async () => {
      const retailId = await createRetailOrder()
      const inventoryId = await createInventoryWorkOrder()
      const designId = await createDesignWorkOrder()

      const ids = await listOrderIds("all")
      expect(ids.has(retailId)).toBe(true)
      expect(ids.has(inventoryId)).toBe(true)
      expect(ids.has(designId)).toBe(true)
    })
  })
})

/**
 * #342 T2 — orders unification dual-write shim.
 *
 * Creating a legacy inventory order must additionally project a core `order`
 * (kind=inventory, discriminated by the order↔inventory_order link since
 * Chunk 6) per apps/docs/notes/ORDERS_UNIFICATION_342.md §3 + §5, without ever
 * failing the legacy create. Also probes the two gaps
 * the doc left to empirical verification:
 *   GAP-1 — core order_line_item.quantity accepts decimals (raw-material kg)
 *   GAP-3 — core order create works customer-less (no customer_id, no email)
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import partnerOrderLink from "../../src/links/partner-order"
import { ORDER_INVENTORY_MODULE } from "../../src/modules/inventory_orders"

jest.setTimeout(60000)

const TEST_PARTNER_EMAIL = "partner@orders-unification-test.com"
const TEST_PARTNER_PASSWORD = "supersecret"

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Orders unification dual-write (#342 T2)", () => {
    let adminHeaders: any
    let inventoryItemId: string
    let stockLocationId: string
    let fromStockLocationId: string

    const createRegion = async () => {
      const container = getContainer()
      const regionService: any = container.resolve(Modules.REGION)
      const region = await regionService.createRegions({
        name: "India",
        currency_code: "inr",
        countries: ["in"],
      })
      return region.id
    }

    const createLegacyOrder = async (overrides: Record<string, any> = {}) => {
      const payload = {
        order_lines: [
          { inventory_item_id: inventoryItemId, quantity: 2.5, price: 100 },
        ],
        quantity: 2.5,
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
          loading_dock: "B",
        },
        stock_location_id: stockLocationId,
        from_stock_location_id: fromStockLocationId,
        ...overrides,
      }
      const res = await api.post("/admin/inventory-orders", payload, adminHeaders)
      expect(res.status).toBe(201)
      return res.data.inventoryOrder
    }

    const fetchUnifiedOrder = async (unifiedOrderId: string) => {
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "order",
        filters: { id: unifiedOrderId },
        fields: [
          "id",
          "status",
          "currency_code",
          "email",
          "customer_id",
          "region_id",
          "metadata",
          "unified_order_status.partner_status",
          "total",
          "sales_channel.name",
          "items.*",
          "shipping_address.*",
        ],
      })
      return data?.[0]
    }

    const fetchLegacyOrder = async (id: string) => {
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_orders",
        filters: { id },
        fields: ["id", "status", "quantity", "total_price", "metadata", "orderlines.*"],
      })
      return data?.[0]
    }

    // Chunk 6: the unified order id is resolved via the order↔inventory_order
    // link (forward `.order`), not the retired metadata.unified_order_id backref.
    const resolveUnifiedViaLink = async (
      legacyId: string
    ): Promise<string | undefined> => {
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_orders",
        filters: { id: legacyId },
        fields: ["id", "order.id"],
      })
      return data?.[0]?.order?.id ?? undefined
    }

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const inventoryRes = await api.post(
        "/admin/inventory-items",
        { title: "Raw Cotton", sku: "RAW-COTTON-KG" },
        adminHeaders
      )
      expect(inventoryRes.status).toBe(200)
      inventoryItemId = inventoryRes.data.inventory_item.id

      const toLocation = await api.post(
        "/admin/stock-locations",
        { name: "Main Warehouse" },
        adminHeaders
      )
      stockLocationId = toLocation.data.stock_location.id
      const fromLocation = await api.post(
        "/admin/stock-locations",
        { name: "Secondary Warehouse" },
        adminHeaders
      )
      fromStockLocationId = fromLocation.data.stock_location.id
    })

    it("dual-writes a kind=inventory core order with decimal quantities and no customer", async () => {
      await createRegion()
      const legacy = await createLegacyOrder()

      const legacyRow = await fetchLegacyOrder(legacy.id)
      const unifiedOrderId = await resolveUnifiedViaLink(legacy.id)
      expect(unifiedOrderId).toBeTruthy()

      const unified = await fetchUnifiedOrder(unifiedOrderId!)
      expect(unified).toBeTruthy()

      // §2/§3 projection metadata (the kind=inventory discriminator is the
      // order↔inventory_order link, asserted forward below).
      expect(unified.metadata.legacy_id).toBe(legacy.id)
      // Chunk 6 regression: `kind` is no longer written onto the order (the
      // link IS the discriminator now).
      expect(unified.metadata.kind).toBeUndefined()
      expect(unified.metadata.is_sample).toBe(false)
      expect(unified.metadata.currency_assumed).toBe(true)
      expect(unified.metadata.total_quantity).toBe(2.5)
      expect(unified.metadata.to_stock_location_id).toBe(stockLocationId)
      expect(unified.metadata.from_stock_location_id).toBe(fromStockLocationId)
      // non-core address keys preserved
      expect(unified.metadata.shipping_address_extra).toEqual({ loading_dock: "B" })

      // §5 status map: legacy Pending → core pending
      expect(unified.status).toBe("pending")

      // GAP-3: truly customer-less — no guest customer was created either
      expect(unified.customer_id ?? null).toBeNull()
      expect(unified.email ?? null).toBeNull()

      // GAP-2: currency falls back to the store default, flagged as assumed
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: stores } = await query.graph({
        entity: "store",
        fields: ["supported_currencies.*"],
      })
      const storeDefaultCurrency =
        stores?.[0]?.supported_currencies?.find((c: any) => c?.is_default)
          ?.currency_code ?? "inr"
      expect(unified.currency_code).toBe(storeDefaultCurrency)

      // Work-orders live on the internal channel, not a storefront channel
      expect(unified.sales_channel?.name).toBe("Partner Work Orders")

      // GAP-1: decimal quantity survives end-to-end; legacy line price is the
      // line total, so unit_price = 100 / 2.5 = 40
      expect(unified.items).toHaveLength(1)
      expect(Number(unified.items[0].quantity)).toBe(2.5)
      expect(Number(unified.items[0].unit_price)).toBe(40)
      expect(unified.items[0].title).toBe("Raw Cotton")
      expect(unified.items[0].metadata.inventory_item_id).toBe(inventoryItemId)

      // Totals parity: Σ(unit_price × qty) == legacy total_price
      expect(Number(unified.total)).toBe(Number(legacyRow.total_price))

      // Core address fields mapped onto a real address row
      expect(unified.shipping_address?.city).toBe("Jaipur")
      expect(unified.shipping_address?.country_code).toBe("in")

      // Legacy row untouched — Chunk 6 stopped writing any projection backref
      // onto it; the link is the sole pointer.
      expect(legacyRow.status).toBe("Pending")
      expect(Number(legacyRow.quantity)).toBe(2.5)
      expect(Number(legacyRow.total_price)).toBe(100)
      expect(legacyRow.orderlines).toHaveLength(1)
      expect(legacyRow.metadata?.unified_order_id ?? null).toBeNull()

      // kind=inventory discriminator: exactly one order↔inventory_order link,
      // resolving forward (legacy row → unified order) to the projected order.
      const { data: linked } = await query.graph({
        entity: "inventory_orders",
        filters: { id: legacy.id },
        fields: ["id", "order.id"],
      })
      expect(linked?.[0]?.order?.id).toBe(unifiedOrderId)
    })

    it("does not fail the legacy create when the dual-write cannot run (no region)", async () => {
      // No region created — the projection step must skip, not throw
      const legacy = await createLegacyOrder()

      const legacyRow = await fetchLegacyOrder(legacy.id)
      expect(legacyRow.status).toBe("Pending")
      // No projection → no order↔inventory_order link.
      expect(await resolveUnifiedViaLink(legacy.id)).toBeFalsy()
    })

    it("mirrors admin status updates onto the unified order (§5)", async () => {
      await createRegion()
      const legacy = await createLegacyOrder()
      const unifiedOrderId = await resolveUnifiedViaLink(legacy.id)
      expect(unifiedOrderId).toBeTruthy()

      // Pending → Processing: core stays pending, work dimension advances
      const res1 = await api.put(
        `/admin/inventory-orders/${legacy.id}`,
        { status: "Processing" },
        adminHeaders
      )
      expect(res1.status).toBe(200)
      let unified = await fetchUnifiedOrder(unifiedOrderId)
      expect(unified.status).toBe("pending")
      // PR-H: partner_status lives only on the typed sidecar column, never metadata.
      expect(unified.unified_order_status?.partner_status).toBe("in_progress")
      expect(unified.metadata.partner_status).toBeUndefined()
      // projection metadata survives the status mirror
      expect(unified.metadata.legacy_id).toBe(legacy.id)

      // Processing → Cancelled: core cancels; §5 defines no partner_status
      // for Cancelled, so the last value is left untouched
      const res2 = await api.put(
        `/admin/inventory-orders/${legacy.id}`,
        { status: "Cancelled" },
        adminHeaders
      )
      expect(res2.status).toBe(200)
      unified = await fetchUnifiedOrder(unifiedOrderId)
      expect(unified.status).toBe("canceled")
      expect(unified.unified_order_status?.partner_status).toBe("in_progress")
    })

    it("resolves the unified order via the link, not the metadata backref (D5-3)", async () => {
      // Chunk 3/6 — the status mirror reads the order↔inventory_order link
      // (query.graph forward `.order`) with PRIORITY over the transitional
      // metadata.unified_order_id fallback (kept only for pre-D5-2 historicals;
      // Chunk 6 no longer writes it). Prove the priority by POISONING the backref
      // with a bogus order id while leaving the link intact: if the mirror still
      // lands on the REAL unified order, it resolved via the link (a backref read
      // would target the bogus id and leave the real order untouched).
      await createRegion()
      const legacy = await createLegacyOrder()
      const unifiedOrderId = await resolveUnifiedViaLink(legacy.id)
      expect(unifiedOrderId).toBeTruthy()

      const container = getContainer()
      const inventoryOrderService: any =
        container.resolve(ORDER_INVENTORY_MODULE)
      await inventoryOrderService.updateInventoryOrders({
        id: legacy.id,
        metadata: { unified_order_id: "order_bogus_does_not_exist" },
      })
      expect((await fetchLegacyOrder(legacy.id)).metadata?.unified_order_id).toBe(
        "order_bogus_does_not_exist"
      )

      const res = await api.put(
        `/admin/inventory-orders/${legacy.id}`,
        { status: "Processing" },
        adminHeaders
      )
      expect(res.status).toBe(200)

      const unified = await fetchUnifiedOrder(unifiedOrderId)
      expect(unified.status).toBe("pending")
      expect(unified.unified_order_status?.partner_status).toBe("in_progress")
    })

    it("keeps legacy updates non-fatal when no unified order exists", async () => {
      // No region → create skipped the dual-write; updates must still work
      const legacy = await createLegacyOrder()
      expect(await resolveUnifiedViaLink(legacy.id)).toBeFalsy()

      const res = await api.put(
        `/admin/inventory-orders/${legacy.id}`,
        { status: "Processing" },
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect((await fetchLegacyOrder(legacy.id)).status).toBe("Processing")
    })

    it("links the partner to the unified order on send-to-partner", async () => {
      // Surface which call fails instead of a bare AxiosError
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

      await createRegion()

      // Partner + the task templates the send-to-partner workflow requires
      await post("/auth/partner/emailpass/register", {
        email: TEST_PARTNER_EMAIL,
        password: TEST_PARTNER_PASSWORD,
      })
      const partnerLogin = await post("/auth/partner/emailpass", {
        email: TEST_PARTNER_EMAIL,
        password: TEST_PARTNER_PASSWORD,
      })
      const partnerRes = await post(
        "/partners",
        {
          name: "Unification Test Partner",
          handle: "orders-unification-partner",
          admin: {
            email: TEST_PARTNER_EMAIL,
            first_name: "Partner",
            last_name: "Admin",
          },
        },
        { headers: { Authorization: `Bearer ${partnerLogin.data.token}` } }
      )
      expect(partnerRes.status).toBe(200)
      const partnerId = partnerRes.data.partner.id

      for (const [name, workflowType] of [
        ["partner-order-sent", "partner_assignment"],
        ["partner-order-received", "partner_assignment"],
        ["partner-order-shipped", "partner_assignment"],
        // required by the partial-delivery branch of partner-complete
        ["partner-line-partial", "partner_completion"],
      ]) {
        const templateRes = await post(
          "/admin/task-templates",
          {
            name,
            description: `${name} template`,
            priority: "medium",
            estimated_duration: 30,
            eventable: true,
            notifiable: true,
            metadata: { workflow_type: workflowType },
          },
          adminHeaders
        )
        expect([200, 201]).toContain(templateRes.status)
      }

      const legacy = await createLegacyOrder()
      const unifiedOrderId = await resolveUnifiedViaLink(legacy.id)
      expect(unifiedOrderId).toBeTruthy()

      const sendRes = await post(
        `/admin/inventory-orders/${legacy.id}/send-to-partner`,
        { partnerId, notes: "unification link test" },
        adminHeaders
      )
      expect(sendRes.status).toBe(200)

      // D3: partner ↔ order link row exists
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: linkRows } = await query.graph({
        entity: partnerOrderLink.entryPoint,
        filters: { order_id: unifiedOrderId },
        fields: ["partner_id", "order_id"],
      })
      expect(linkRows).toHaveLength(1)
      expect(linkRows[0].partner_id).toBe(partnerId)

      // §5: assignment mirrors partner_status = "assigned" onto the sidecar column
      let unified = await fetchUnifiedOrder(unifiedOrderId)
      expect(unified.unified_order_status?.partner_status).toBe("assigned")

      // ——— partner lifecycle: start → in_progress, complete → finished ———
      // Fresh token after partner creation (critical for auth context)
      const freshLogin = await post("/auth/partner/emailpass", {
        email: TEST_PARTNER_EMAIL,
        password: TEST_PARTNER_PASSWORD,
      })
      const partnerHeaders = {
        headers: { Authorization: `Bearer ${freshLogin.data.token}` },
      }

      const startRes = await post(
        `/partners/inventory-orders/${legacy.id}/start`,
        {},
        partnerHeaders
      )
      expect(startRes.status).toBe(200)
      expect((await fetchLegacyOrder(legacy.id)).status).toBe("Processing")
      unified = await fetchUnifiedOrder(unifiedOrderId)
      expect(unified.status).toBe("pending")
      expect(unified.unified_order_status?.partner_status).toBe("in_progress")

      const legacyLines = (await fetchLegacyOrder(legacy.id)).orderlines

      // Decimal partial delivery (1.5 of 2.5 kg): legacy goes Partial →
      // unified work dimension "partial" (decided 2026-06-12 — panels must
      // distinguish partially-delivered from finished). Decimal quantities
      // also regression-test the quantity_delta integer→real migration:
      // before it, 1.5 rounded to 2 and the remainder tripped the
      // over-delivery guard.
      const partialRes = await post(
        `/partners/inventory-orders/${legacy.id}/complete`,
        {
          notes: "unification status mirror test — partial",
          lines: legacyLines.map((l: any) => ({
            order_line_id: l.id,
            quantity: 1.5,
          })),
        },
        partnerHeaders
      )
      expect(partialRes.status).toBe(200)
      expect((await fetchLegacyOrder(legacy.id)).status).toBe("Partial")
      unified = await fetchUnifiedOrder(unifiedOrderId)
      expect(unified.status).toBe("pending")
      expect(unified.unified_order_status?.partner_status).toBe("partial")

      // Remainder (1.0): fully fulfilled — legacy Shipped → unified finished
      const completeRes = await post(
        `/partners/inventory-orders/${legacy.id}/complete`,
        {
          notes: "unification status mirror test — remainder",
          lines: legacyLines.map((l: any) => ({
            order_line_id: l.id,
            quantity: 1.0,
          })),
        },
        partnerHeaders
      )
      expect(completeRes.status).toBe(200)
      expect((await fetchLegacyOrder(legacy.id)).status).toBe("Shipped")
      unified = await fetchUnifiedOrder(unifiedOrderId)
      expect(unified.status).toBe("pending")
      expect(unified.unified_order_status?.partner_status).toBe("finished")
    })
  })
})

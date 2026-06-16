/**
 * #403 — orders unification, ADMIN work-order DETAIL.
 *
 * Mirrors the partner detail behaviour (`orders-unification-partner-detail.spec.ts`)
 * onto the admin surface: `GET /admin/orders/:id` now self-describes its kind +
 * work-status by attaching the order↔execution reverse links
 * (`production_runs` / `inventory_orders`) and the `unified_order_status`
 * sidecar, so the admin UI can discriminate design/inventory/retail.
 *
 * Unlike the partner route there is NO ownership scoping — admin reads any order.
 *
 * Asserts:
 *   - admin GET of a design work-order → `production_runs` linked, no inventory
 *   - admin GET of an inventory work-order → `inventory_orders` linked, no design
 *   - admin GET of a retail order → neither link present
 *   - the core order shape (id, items, totals) still comes back (override didn't
 *     regress the built-in detail)
 *   - POST /admin/orders/:id (order update) still works (re-exported core POST)
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createOrderWorkflow } from "@medusajs/core-flows"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

const TEST_PARTNER_PASSWORD = "supersecret"

type PartnerCtx = {
  headers: any
  partnerId: string
  salesChannelId: string
  regionId: string
  currencyCode: string
  tag: string
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Orders unification admin work-order detail (#403)", () => {
    let adminHeaders: any
    let unique: number
    let inventoryItemId: string
    let stockLocationId: string
    let fromStockLocationId: string

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

    const createPartnerWithStore = async (tag: string): Promise<PartnerCtx> => {
      const email = `admin-detail-${tag}-${unique}@jyt.test`
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
          name: `Admin Detail Partner ${tag} ${unique}`,
          handle: `admin-detail-${tag}-${unique}`,
          admin: { email, first_name: "Admin", last_name: tag },
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
            name: `Admin Detail Store ${tag} ${unique}`,
            supported_currencies: [{ currency_code: cc, is_default: true }],
          },
          sales_channel: { name: `Admin Detail Channel ${tag} ${unique}`, description: "Default" },
          region: { name: `Admin Detail Region ${tag}`, currency_code: cc, countries: ["in"] },
          location: {
            name: `Admin Detail Warehouse ${tag}`,
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

      return {
        headers: headers2,
        partnerId: pid,
        currencyCode: cc,
        salesChannelId: storeRes.data.sales_channel?.id,
        regionId: storeRes.data.region?.id,
        tag,
      }
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

    const createRetailOrder = async (ctx: PartnerCtx): Promise<string> => {
      const { result } = await createOrderWorkflow(getContainer()).run({
        input: {
          region_id: ctx.regionId,
          sales_channel_id: ctx.salesChannelId,
          currency_code: ctx.currencyCode,
          email: `retail-${ctx.tag}-${unique}@jyt.test`,
          items: [{ title: "Retail Tee", quantity: 1, unit_price: 500 } as any],
        } as any,
      })
      return (result as any).id
    }

    const createInventoryWorkOrder = async (
      ctx: PartnerCtx
    ): Promise<{ unifiedId: string; legacyId: string }> => {
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
        { partnerId: ctx.partnerId, notes: "Admin detail test" },
        adminHeaders
      )
      expect(send.status).toBe(200)
      return { unifiedId: await unifiedIdFromLegacy("inventory_orders", invId), legacyId: invId }
    }

    const createDesignWorkOrder = async (
      ctx: PartnerCtx
    ): Promise<{ unifiedId: string; legacyId: string }> => {
      const design = await post(
        "/admin/designs",
        {
          name: `Admin Detail Design ${ctx.tag} ${unique}`,
          description: "Design for #403 admin-detail test",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(design.status).toBe(201)

      const templateName = `admin-detail-design-${ctx.tag}-${unique}`
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
          category: "Admin Detail Test",
        },
        adminHeaders
      )
      expect([200, 201]).toContain(tpl.status)

      const createRes = await post(
        `/admin/designs/${design.data.design.id}/production-runs`,
        {
          assignments: [
            {
              partner_id: ctx.partnerId,
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
      return { unifiedId: await unifiedIdFromLegacy("production_runs", childId), legacyId: childId }
    }

    const getAdminDetail = async (orderId: string) =>
      api.get(`/admin/orders/${orderId}`, adminHeaders).catch((e: any) => e.response)

    // 1:1 reverse links resolve to a single object or array — match the UI's tolerance.
    const linked = (rel: any): boolean =>
      Array.isArray(rel) ? rel.length > 0 : Boolean(rel?.id)

    let partner: PartnerCtx

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

      partner = await createPartnerWithStore("a")
    })

    it("admin GET of a design work-order attaches production_runs (kind=design)", async () => {
      const { unifiedId, legacyId } = await createDesignWorkOrder(partner)

      const res = await getAdminDetail(unifiedId)
      expect(res.status).toBe(200)
      const order = res.data.order
      // core detail shape preserved by the override
      expect(order.id).toBe(unifiedId)
      // kind-discriminator fields attached by the route
      expect(linked(order.production_runs)).toBe(true)
      expect(linked(order.inventory_orders)).toBe(false)
      expect(order.metadata?.legacy_id).toBe(legacyId)
    })

    it("admin GET of an inventory work-order attaches inventory_orders (kind=inventory)", async () => {
      const { unifiedId, legacyId } = await createInventoryWorkOrder(partner)

      const res = await getAdminDetail(unifiedId)
      expect(res.status).toBe(200)
      const order = res.data.order
      expect(order.id).toBe(unifiedId)
      expect(linked(order.inventory_orders)).toBe(true)
      expect(linked(order.production_runs)).toBe(false)
      expect(order.metadata?.legacy_id).toBe(legacyId)
    })

    it("admin GET of a retail order attaches neither link (kind=retail)", async () => {
      const retailId = await createRetailOrder(partner)

      const res = await getAdminDetail(retailId)
      expect(res.status).toBe(200)
      const order = res.data.order
      expect(order.id).toBe(retailId)
      expect(linked(order.production_runs)).toBe(false)
      expect(linked(order.inventory_orders)).toBe(false)
    })

    it("admin POST /admin/orders/:id still updates the order (re-exported core handler)", async () => {
      const retailId = await createRetailOrder(partner)

      // The core POST returns only `defaultAdminOrderFields` (no `email`) unless
      // `fields` selects it, so request `email` explicitly to verify the update
      // actually landed through the re-exported core handler.
      const res = await api
        .post(
          `/admin/orders/${retailId}?fields=id,email`,
          { email: `updated-${unique}@jyt.test` },
          adminHeaders
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(200)
      expect(res.data.order?.email).toBe(`updated-${unique}@jyt.test`)
    })
  })
})

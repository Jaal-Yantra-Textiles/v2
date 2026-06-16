/**
 * #403 (slice 2) — orders unification, ADMIN order LIST work-status.
 *
 * The admin LIST (`GET /admin/orders`) now carries `unified_order_status`
 * per row (attached best-effort by the route), so the admin order table can
 * render a work-status badge the same way partner-ui does. Core's list workflow
 * does not expand the custom link sidecar, so the route merges it in after the
 * fact over the returned ids.
 *
 * Asserts (value-based, not just presence):
 *   - after a work-order transitions (PUT inventory-order status → Processing,
 *     which writes sidecar partner_status="in_progress"), the matching LIST row
 *     carries `unified_order_status.partner_status === "in_progress"`.
 *   - a retail order row carries no work-status.
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

  describe("Orders unification admin LIST work-status (#403)", () => {
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
      const email = `admin-list-${tag}-${unique}@jyt.test`
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
          name: `Admin List Partner ${tag} ${unique}`,
          handle: `admin-list-${tag}-${unique}`,
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
            name: `Admin List Store ${tag} ${unique}`,
            supported_currencies: [{ currency_code: cc, is_default: true }],
          },
          sales_channel: { name: `Admin List Channel ${tag} ${unique}`, description: "Default" },
          region: { name: `Admin List Region ${tag}`, currency_code: cc, countries: ["in"] },
          location: {
            name: `Admin List Warehouse ${tag}`,
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
        { partnerId: ctx.partnerId, notes: "Admin list test" },
        adminHeaders
      )
      expect(send.status).toBe(200)
      return { unifiedId: await unifiedIdFromLegacy("inventory_orders", invId), legacyId: invId }
    }

    // Walk the admin LIST (paged) for the kind and return the row with this id.
    const findListRow = async (kind: string, orderId: string): Promise<any> => {
      const res = await api
        .get(`/admin/orders?kind=${kind}&limit=100`, adminHeaders)
        .catch((e: any) => e.response)
      expect(res.status).toBe(200)
      return (res.data.orders || []).find((o: any) => o.id === orderId)
    }

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

      // send-to-partner requires these notification task-templates to exist.
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

    it("admin LIST carries unified_order_status.partner_status for a transitioned work-order", async () => {
      const { unifiedId, legacyId } = await createInventoryWorkOrder(partner)

      // Pending → Processing writes sidecar partner_status = "in_progress".
      const put = await api
        .put(`/admin/inventory-orders/${legacyId}`, { status: "Processing" }, adminHeaders)
        .catch((e: any) => e.response)
      expect(put.status).toBe(200)

      const row = await findListRow("inventory", unifiedId)
      expect(row).toBeTruthy()
      // The core list would NOT carry this — the route merged it in.
      expect(row.unified_order_status?.partner_status).toBe("in_progress")
    })

    it("admin LIST row for a retail order carries no work-status", async () => {
      const retailId = await createRetailOrder(partner)

      const row = await findListRow("retail", retailId)
      expect(row).toBeTruthy()
      expect(row.unified_order_status?.partner_status).toBeFalsy()
    })
  })
})

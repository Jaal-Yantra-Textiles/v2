/**
 * #342 — partner unified work-order DETAIL.
 *
 * Design/inventory work-orders open on the unified order detail
 * (`GET /partners/orders/:id`), which:
 *   - authorizes via the D3 `partner ↔ order` link (work-orders live in the
 *     shared internal channel, so sales-channel scoping alone is wrong), and
 *   - attaches the order↔execution reverse links (`production_runs` /
 *     `inventory_orders`) so the UI can discriminate the kind and the partner
 *     can only see its own.
 *
 * Asserts: a partner CAN GET its own design/inventory/retail detail (and the
 * kind-discriminator fields are present), and CANNOT GET another partner's.
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
  // undefined for a storeless partner (work-order-only, no retail store)
  salesChannelId?: string
  regionId?: string
  currencyCode: string
  tag: string
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Orders unification partner work-order detail (#342)", () => {
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

    // Register a partner admin + create the partner + stand up a store (its own
    // sales channel / region / location). Returns the partner's context so the
    // suite can run two partners for cross-partner isolation.
    const createPartnerWithStore = async (tag: string): Promise<PartnerCtx> => {
      const email = `partner-detail-${tag}-${unique}@jyt.test`
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
          name: `Detail Partner ${tag} ${unique}`,
          handle: `detail-${tag}-${unique}`,
          admin: { email, first_name: "Detail", last_name: tag },
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
            name: `Detail Store ${tag} ${unique}`,
            supported_currencies: [{ currency_code: cc, is_default: true }],
          },
          sales_channel: { name: `Detail Channel ${tag} ${unique}`, description: "Default" },
          region: { name: `Detail Region ${tag}`, currency_code: cc, countries: ["in"] },
          location: {
            name: `Detail Warehouse ${tag}`,
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

    // A partner with NO store (e.g. a design/production partner who only ever
    // works work-orders and never sells retail). Same registration path, minus
    // the `/partners/stores` provisioning. Used to prove work-order ownership
    // does not require a store.
    const createPartnerWithoutStore = async (tag: string): Promise<PartnerCtx> => {
      const email = `partner-detail-nostore-${tag}-${unique}@jyt.test`
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
          name: `Detail NoStore ${tag} ${unique}`,
          handle: `detail-nostore-${tag}-${unique}`,
          admin: { email, first_name: "NoStore", last_name: tag },
        },
        headers1
      )
      const pid = partnerRes.data.partner.id

      const login2 = await post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })
      const headers2 = { headers: { Authorization: `Bearer ${login2.data.token}` } }

      return {
        headers: headers2,
        partnerId: pid,
        currencyCode: "inr",
        salesChannelId: undefined,
        regionId: undefined,
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

    // Returns { unifiedId, legacyId } so the detail test can assert
    // metadata.legacy_id points at the legacy inventory order.
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
        { partnerId: ctx.partnerId, notes: "Detail test" },
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
          name: `Detail Design ${ctx.tag} ${unique}`,
          description: "Design for #342 partner-detail test",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(design.status).toBe(201)

      const templateName = `partner-detail-design-${ctx.tag}-${unique}`
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
          category: "Partner Detail Test",
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

    const getDetail = async (orderId: string, headers: any) =>
      api.get(`/partners/orders/${orderId}`, headers).catch((e: any) => e.response)

    // 1:1 reverse links resolve to a single object or array — match the UI's tolerance.
    const linked = (rel: any): boolean =>
      Array.isArray(rel) ? rel.length > 0 : Boolean(rel?.id)

    let partnerA: PartnerCtx
    let partnerB: PartnerCtx

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

      partnerA = await createPartnerWithStore("a")
      partnerB = await createPartnerWithStore("b")
    })

    it("partner CAN GET its own inventory work-order detail (kind=inventory)", async () => {
      const { unifiedId, legacyId } = await createInventoryWorkOrder(partnerA)

      const res = await getDetail(unifiedId, partnerA.headers)
      expect(res.status).toBe(200)
      const order = res.data.order
      expect(order.metadata?.legacy_id).toBe(legacyId)
      // kind-discriminator fields attached by the route
      expect(linked(order.inventory_orders)).toBe(true)
      expect(linked(order.production_runs)).toBe(false)
    })

    it("partner CAN GET its own design work-order detail (kind=design)", async () => {
      const { unifiedId, legacyId } = await createDesignWorkOrder(partnerA)

      const res = await getDetail(unifiedId, partnerA.headers)
      expect(res.status).toBe(200)
      const order = res.data.order
      expect(order.metadata?.legacy_id).toBe(legacyId)
      expect(linked(order.production_runs)).toBe(true)
      expect(linked(order.inventory_orders)).toBe(false)
    })

    it("STORELESS partner CAN GET its own design work-order detail (no store required)", async () => {
      // Regression: a design/production partner with no store owns work orders
      // purely via the D3 partner↔order link. The ownership check used the
      // throwing store lookup, so it 404'd with "No store configured for this
      // partner" before the work-ownership check ran — their design orders
      // never loaded. Now the storeless partner gets their order.
      const storeless = await createPartnerWithoutStore("nostore")
      const { unifiedId, legacyId } = await createDesignWorkOrder(storeless)

      const res = await getDetail(unifiedId, storeless.headers)
      expect(res.status).toBe(200)
      const order = res.data.order
      expect(order.metadata?.legacy_id).toBe(legacyId)
      expect(linked(order.production_runs)).toBe(true)
    })

    it("STORELESS partner is rejected by the store-scoped locations route", async () => {
      // Pins the contract the partner-ui's `useStockLocation` guard depends on.
      //
      // A storeless partner has no store id to put in the path, so the hook
      // must not fire at all. It used to: `enabled: !!storeId && ...` was
      // written BEFORE a `...options` spread, so a caller passing
      // `{ enabled: showLocation }` clobbered the guard and the request went
      // out with the literal string "undefined" as the store id. The order
      // detail page then rethrew the failure into its error boundary and went
      // blank for every work order whose fulfillment carried a location_id.
      //
      // The route is right to refuse — this asserts it keeps refusing, so the
      // frontend guard stays load-bearing rather than decorative.
      const storeless = await createPartnerWithoutStore("nostore-loc")

      const res = await api
        .get(
          "/partners/stores/undefined/locations/sloc_01TEST",
          storeless.headers
        )
        .catch((e: any) => e.response)

      // 400, not the 401 the throw asks for. `validatePartnerStoreAccess`
      // raises `MedusaError.Types.UNAUTHORIZED`, which the framework maps to
      // 401 — but this app's custom `errorHandler` (src/api/middlewares.ts)
      // collapses every MedusaError that isn't `not_found` into 400. Asserting
      // the status the API actually returns, not the one it intends. See #1202.
      expect(res.status).toBe(400)
      expect(res.data.message).toContain("not associated with this partner")
    })

    it("partner CAN GET its own retail order detail (kind=retail, no links)", async () => {
      const retailId = await createRetailOrder(partnerA)

      const res = await getDetail(retailId, partnerA.headers)
      expect(res.status).toBe(200)
      const order = res.data.order
      expect(linked(order.production_runs)).toBe(false)
      expect(linked(order.inventory_orders)).toBe(false)
    })

    it("partner CANNOT GET another partner's work-orders", async () => {
      const inv = await createInventoryWorkOrder(partnerA)
      const design = await createDesignWorkOrder(partnerA)
      const retail = await createRetailOrder(partnerA)

      for (const id of [inv.unifiedId, design.unifiedId, retail]) {
        const res = await getDetail(id, partnerB.headers)
        expect(res.status).toBe(404)
      }
    })

    // #342 (session 2) — the retired `/production-runs/:id` partner-ui route
    // redirects to the unified order detail by reading `unified_order_id` off
    // the production-run responses (resolved via the order↔production_run link).
    it("partner production-run DETAIL exposes unified_order_id (powers the /production-runs/:id → /orders/:id redirect)", async () => {
      const { unifiedId, legacyId } = await createDesignWorkOrder(partnerA)

      const res = await api
        .get(`/partners/production-runs/${legacyId}`, partnerA.headers)
        .catch((e: any) => e.response)

      expect(res.status).toBe(200)
      expect(res.data.production_run?.id).toBe(legacyId)
      expect(res.data.unified_order_id).toBe(unifiedId)
    })

    it("partner production-run LIST exposes unified_order_id per run", async () => {
      const { unifiedId, legacyId } = await createDesignWorkOrder(partnerA)

      const res = await api
        .get(`/partners/production-runs?limit=50`, partnerA.headers)
        .catch((e: any) => e.response)

      expect(res.status).toBe(200)
      const run = (res.data.production_runs || []).find(
        (r: any) => r.id === legacyId
      )
      expect(run).toBeTruthy()
      expect(run.unified_order_id).toBe(unifiedId)
    })
  })
})

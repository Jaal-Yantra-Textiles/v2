/**
 * #2264 S2b — the ADMIN order reads, with `WORK_ORDER_READS` off and on.
 *
 * Replaces the three #342/#403 admin specs (orders-unification-admin-detail,
 * -admin-list-filter, -admin-list-workstatus). Every behaviour they pinned is
 * pinned here, on the SAME fixture, twice: once from the core-order mirror
 * (flag off — what prod serves today) and once from `work_order` (flag on).
 *
 * "Passes with the flag on" proves nothing unless the answer is also proven to
 * come from `work_order`. Two markers:
 *   - the mirror carries the internal "Partner Work Orders" sales channel;
 *     `toOrderShape` serves `sales_channel_id: null`;
 *   - for /admin/design-work-orders, which returns no channel, a column is
 *     changed on the `work_order` row ONLY and must show up with the flag on
 *     and not with it off.
 */
import { createOrderWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { workOrderParityJob } from "../../src/api/admin/ops/maintenance-jobs/work-order-jobs"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { WORK_ORDER_MODULE } from "../../src/modules/work_orders"
import { produceDesignsAsWorkOrder } from "../../src/workflows/designs/produce-designs-as-work-order"
import {
  pickWorkOrderContract,
  pickWorkOrderListContract,
} from "../../src/lib/work-orders/work-order-contract"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ensureHouseStoreRegion } from "../helpers/ensure-house-store-region"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

const PASSWORD = "supersecret"
const FLAGS = ["off", "on"] as const
type Flag = (typeof FLAGS)[number]

const setFlag = (flag: Flag) => {
  if (flag === "on") process.env.WORK_ORDER_READS = "true"
  else delete process.env.WORK_ORDER_READS
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("admin order reads, mirror vs work_order (#2264 S2b)", () => {
    let adminHeaders: any
    let unique: number
    let partnerId: string
    let inventoryItemId: string
    let stockLocationId: string
    let fromStockLocationId: string

    // The fixture: one of each kind of order.
    let retailId: string
    let inventory: { orderId: string; invId: string }
    let design: { orderId: string; runId: string }
    let collated: { orderId: string; runIds: string[]; partnerId: string }

    const post = async (url: string, body: any, cfg: any = adminHeaders) => {
      try {
        return await api.post(url, body, cfg)
      } catch (err: any) {
        throw new Error(`POST ${url} failed: ${err?.response?.status} ${JSON.stringify(err?.response?.data)}`)
      }
    }

    const get = async (url: string) => {
      const res = await api.get(url, adminHeaders).catch((e: any) => e.response)
      expect(res.status).toBe(200)
      return res.data
    }

    const mirrorIdOf = async (entity: "inventory_orders" | "production_runs", id: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({ entity, filters: { id }, fields: ["id", "order.id"] })
      const orderId = data?.[0]?.order?.id
      expect(orderId).toBeTruthy()
      return orderId as string
    }

    // The route's DEFAULT fields leave out the channel (the marker) and the
    // currency, which the admin order page always requests explicitly
    // (@medusajs/dashboard order-detail/constants.ts DEFAULT_PROPERTIES).
    const MARKER = `fields=${encodeURIComponent("+sales_channel_id,+currency_code")}`

    const listIds = async (qs: string) =>
      new Set<string>((await get(`/admin/orders?${qs}&limit=1000`)).orders.map((o: any) => o.id))

    const listRow = async (kind: string, id: string) =>
      (await get(`/admin/orders?kind=${kind}&limit=1000&${MARKER}`)).orders.find(
        (o: any) => o.id === id
      )

    // The mirror's 1:1 reverse links resolve to an object OR an array; the UI
    // tolerates both, and so does this.
    const linked = (rel: any): boolean =>
      Array.isArray(rel) ? rel.length > 0 : Boolean(rel?.id)

    /** Read with the flag off, then on. The flag is always left off. */
    const bothWays = async <T>(read: () => Promise<T>): Promise<Record<Flag, T>> => {
      const out = {} as Record<Flag, T>
      try {
        for (const flag of FLAGS) {
          setFlag(flag)
          out[flag] = await read()
        }
      } finally {
        setFlag("off")
      }
      return out
    }

    beforeEach(async () => {
      const container = getContainer()
      unique = Date.now()
      await createAdminUser(container)
      await ensureHouseStoreRegion(container)
      adminHeaders = await getAuthHeaders(api)

      // A partner that can log in: send-to-partner messages them.
      const email = `wo-admin-${unique}@jyt.test`
      await post("/auth/partner/emailpass/register", { email, password: PASSWORD }, undefined)
      const login = await post("/auth/partner/emailpass", { email, password: PASSWORD }, undefined)
      partnerId = (
        await post(
          "/partners",
          {
            name: `WO Admin ${unique}`,
            handle: `wo-admin-${unique}`,
            admin: { email, first_name: "WO", last_name: "Admin" },
          },
          { headers: { Authorization: `Bearer ${login.data.token}` } }
        )
      ).data.partner.id

      for (const name of ["partner-order-sent", "partner-order-received", "partner-order-shipped"]) {
        await post("/admin/task-templates", {
          name,
          description: `${name} template`,
          priority: "medium",
          estimated_duration: 30,
          eventable: true,
          notifiable: true,
          metadata: { workflow_type: "partner_assignment" },
        })
      }

      inventoryItemId = (
        await post("/admin/inventory-items", { title: "Raw Linen", sku: `RAW-LINEN-${unique}` })
      ).data.inventory_item.id
      stockLocationId = (await post("/admin/stock-locations", { name: `To ${unique}` })).data
        .stock_location.id
      fromStockLocationId = (await post("/admin/stock-locations", { name: `From ${unique}` })).data
        .stock_location.id

      // RETAIL — a plain core sale.
      const region = await (container.resolve(Modules.REGION) as any).createRegions({
        name: `WO Admin Region ${unique}`,
        currency_code: "inr",
        countries: [],
      })
      const channel = await (container.resolve(Modules.SALES_CHANNEL) as any).createSalesChannels({
        name: `WO Admin Channel ${unique}`,
      })
      const { result } = await createOrderWorkflow(container).run({
        input: {
          region_id: region.id,
          sales_channel_id: channel.id,
          currency_code: "inr",
          email: `retail-${unique}@jyt.test`,
          items: [{ title: "Retail Tee", quantity: 1, unit_price: 500 } as any],
        } as any,
      })
      retailId = (result as any).id

      // INVENTORY — a fractional cloth purchase, sent to the partner.
      const inv = await post("/admin/inventory-orders", {
        order_lines: [{ inventory_item_id: inventoryItemId, quantity: 70.6, price: 690 }],
        quantity: 70.6,
        total_price: 48714,
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
      })
      const invId = inv.data.inventoryOrder.id
      await post(`/admin/inventory-orders/${invId}/send-to-partner`, { partnerId, notes: "#2264" })
      inventory = { invId, orderId: await mirrorIdOf("inventory_orders", invId) }

      // DESIGN, per run — one run assigned to the partner.
      const d = await post("/admin/designs", {
        name: `WO Admin Design ${unique}`,
        description: "#2264",
        design_type: "Original",
        status: "Approved",
        priority: "Medium",
      })
      const templateName = `wo-admin-design-${unique}`
      await post("/admin/task-templates", {
        name: templateName,
        description: "t",
        priority: "medium",
        estimated_duration: 60,
        required_fields: {},
        eventable: false,
        notifiable: false,
        message_template: "",
        metadata: { workflow_type: "production_run" },
        category: "WO Admin",
      })
      const runs = await post(`/admin/designs/${d.data.design.id}/production-runs`, {
        assignments: [
          { partner_id: partnerId, quantity: 4, role: "manufacturing", template_names: [templateName] },
        ],
      })
      const runId = runs.data.children?.[0]?.id ?? runs.data.result?.children?.[0]?.id
      expect(runId).toBeTruthy()
      design = { runId, orderId: await mirrorIdOf("production_runs", runId) }

      // DESIGN, collated — two designs sent to production as ONE work order (#826).
      const batch: string[] = []
      for (let i = 0; i < 2; i++) {
        batch.push(
          (
            await post("/admin/designs", {
              name: `WO Admin Batch ${unique}-${i}`,
              description: "#2264",
              design_type: "Original",
              status: "Approved",
              priority: "Medium",
            })
          ).data.design.id
        )
      }
      // A SECOND partner: sent to the first, the batch joins that partner's
      // open design work order instead of making its own.
      const batchPartner = await (container.resolve(PARTNER_MODULE) as any).createPartners({
        name: `WO Admin Batch Partner ${unique}`,
        handle: `wo-admin-batch-${unique}`,
      })
      const produced = await produceDesignsAsWorkOrder(container, batch, batchPartner.id)
      expect(produced.work_order_id).toBeTruthy()
      expect(produced.work_order_id).not.toBe(design.orderId)
      collated = {
        orderId: produced.work_order_id!,
        runIds: produced.run_ids,
        partnerId: batchPartner.id,
      }
    })

    afterEach(() => setFlag("off"))

    // ---------------------------------------------------------------- LIST --

    it("list: each kind holds exactly its own orders, from work_order with the flag on", async () => {
      const ids = await bothWays(async () => ({
        default: await listIds(""),
        retail: await listIds("kind=retail"),
        design: await listIds("kind=design"),
        inventory: await listIds("kind=inventory"),
        all: await listIds("kind=all"),
      }))

      for (const flag of FLAGS) {
        const s = ids[flag]
        // Default = retail: the sale, and no work order.
        for (const set of [s.default, s.retail]) {
          expect(set.has(retailId)).toBe(true)
          expect(set.has(inventory.orderId)).toBe(false)
          expect(set.has(design.orderId)).toBe(false)
          expect(set.has(collated.orderId)).toBe(false)
        }
        // (The shared DB keeps earlier tests' orders, so membership, not equality.)
        expect(s.design.has(design.orderId)).toBe(true)
        expect(s.design.has(collated.orderId)).toBe(true)
        expect(s.design.has(inventory.orderId)).toBe(false)
        expect(s.design.has(retailId)).toBe(false)
        expect(s.inventory.has(inventory.orderId)).toBe(true)
        expect(s.inventory.has(design.orderId)).toBe(false)
        expect(s.inventory.has(collated.orderId)).toBe(false)
        expect(s.inventory.has(retailId)).toBe(false)
        for (const id of [retailId, inventory.orderId, design.orderId, collated.orderId]) {
          expect(s.all.has(id)).toBe(true)
        }
      }
      // Same membership both ways — nothing gained, nothing lost.
      for (const k of ["default", "retail", "design", "inventory", "all"] as const) {
        expect([...ids.on[k]].sort()).toEqual([...ids.off[k]].sort())
      }
    })

    it("list: work-order rows come from work_order and read the same", async () => {
      const rows = await bothWays(async () => ({
        design: await listRow("design", design.orderId),
        collated: await listRow("design", collated.orderId),
        inventory: await listRow("inventory", inventory.orderId),
        viaAll: await listRow("all", inventory.orderId),
        counts: {
          design: (await get(`/admin/orders?kind=design&limit=1`)).count,
          inventory: (await get(`/admin/orders?kind=inventory&limit=1`)).count,
          all: (await get(`/admin/orders?kind=all&limit=1`)).count,
          retail: (await get(`/admin/orders?kind=retail&limit=1`)).count,
        },
      }))

      for (const key of ["design", "collated", "inventory", "viaAll"] as const) {
        // The marker: core answered with the flag off, work_order with it on.
        expect(rows.off[key].sales_channel_id).toBeTruthy()
        expect(rows.on[key].sales_channel_id).toBeNull()
        expect(pickWorkOrderListContract(rows.on[key])).toEqual(pickWorkOrderListContract(rows.off[key]))
      }
      expect(rows.on.counts).toEqual(rows.off.counts)
    })

    it("list: kind=all pages through the merged sources with no gap or repeat", async () => {
      setFlag("on")
      const everything = (await get(`/admin/orders?kind=all&limit=1000`)).orders.map((o: any) => o.id)
      const paged: string[] = []
      for (let offset = 0; offset < everything.length; offset += 2) {
        const page = await get(`/admin/orders?kind=all&limit=2&offset=${offset}`)
        expect(page.count).toBe(everything.length)
        paged.push(...page.orders.map((o: any) => o.id))
      }
      expect(paged).toEqual(everything)
    })

    it("list: a retail-only filter on a work-order kind narrows to nothing, never widens", async () => {
      const res = await bothWays(async () => ({
        byCustomer: await listIds("kind=design&customer_id=cus_nobody"),
        byRegion: await listIds("kind=inventory&region_id=reg_nowhere"),
        byId: await listIds(`kind=design&id=${design.orderId}`),
      }))
      for (const flag of FLAGS) {
        expect(res[flag].byCustomer.size).toBe(0)
        expect(res[flag].byRegion.size).toBe(0)
        expect([...res[flag].byId]).toEqual([design.orderId])
      }
    })

    it("list: a work order carries its work-status; a retail row carries none", async () => {
      // Pending → Processing writes partner_status = in_progress (mirror sidecar
      // AND work_order, through the shadow write).
      const put = await api
        .put(`/admin/inventory-orders/${inventory.invId}`, { status: "Processing" }, adminHeaders)
        .catch((e: any) => e.response)
      expect(put.status).toBe(200)

      const rows = await bothWays(async () => ({
        inventory: await listRow("inventory", inventory.orderId),
        retail: await listRow("retail", retailId),
      }))
      for (const flag of FLAGS) {
        expect(rows[flag].inventory.unified_order_status?.partner_status).toBe("in_progress")
        expect(rows[flag].retail.unified_order_status?.partner_status).toBeFalsy()
      }
      expect(rows.on.inventory.sales_channel_id).toBeNull()
    })

    // -------------------------------------------------------------- DETAIL --

    it("detail: design, collated and inventory work orders read the same from work_order", async () => {
      const cases = [
        { id: design.orderId, runs: true, legacy: design.runId },
        { id: collated.orderId, runs: true, legacy: null },
        { id: inventory.orderId, runs: false, legacy: inventory.invId },
      ]
      for (const c of cases) {
        const got = await bothWays(async () => (await get(`/admin/orders/${c.id}?${MARKER}`)).order)
        expect(got.off.sales_channel_id).toBeTruthy()
        expect(got.on.sales_channel_id).toBeNull()

        for (const flag of FLAGS) {
          const o = got[flag]
          expect(o.id).toBe(c.id)
          expect(linked(o.production_runs)).toBe(c.runs)
          expect(linked(o.inventory_orders)).toBe(!c.runs)
          if (c.legacy) expect(o.metadata?.legacy_id).toBe(c.legacy)
        }
        expect(pickWorkOrderContract(got.on)).toEqual(pickWorkOrderContract(got.off))

        // What the core admin order page reads with no optional chain.
        expect(got.on.summary.pending_difference).toBe(got.off.summary.pending_difference)
        for (const item of got.on.items) {
          expect(item.detail.fulfilled_quantity).toBe(0)
        }
      }
    })

    it("detail: a retail order is untouched by the flag, and POST still updates it", async () => {
      const got = await bothWays(async () => (await get(`/admin/orders/${retailId}`)).order)
      expect(got.on).toEqual(got.off)
      expect(linked(got.on.production_runs)).toBe(false)
      expect(linked(got.on.inventory_orders)).toBe(false)

      const res = await post(`/admin/orders/${retailId}?fields=id,email`, {
        email: `updated-${unique}@jyt.test`,
      })
      expect(res.status).toBe(200)
      expect(res.data.order?.email).toBe(`updated-${unique}@jyt.test`)
    })

    // ---------------------------------------------- DESIGN WORK ORDERS PAGE --

    it("design-work-orders: the collated order reads the same, and comes from work_order", async () => {
      const read = async (qs = "") => get(`/admin/design-work-orders?limit=50${qs}`)
      const got = await bothWays(async () => ({
        all: await read(),
        byId: await read(`&id=${collated.orderId}`),
        byPartner: await read(`&partner_id=${collated.partnerId}`),
        byOtherPartner: await read(`&partner_id=partner_nobody`),
      }))

      for (const flag of FLAGS) {
        // Only the COLLATED order — a per-run design order is not listed here.
        const ids = got[flag].all.design_work_orders.map((r: any) => r.id)
        expect(ids).toContain(collated.orderId)
        expect(ids).not.toContain(design.orderId)
        expect(got[flag].byId.design_work_orders.map((r: any) => r.id)).toEqual([collated.orderId])
        expect(got[flag].byPartner.design_work_orders.map((r: any) => r.id)).toEqual([collated.orderId])
        expect(got[flag].byOtherPartner.count).toBe(0)
        expect(got[flag].byId.design_work_orders[0].design_count).toBe(collated.runIds.length)
      }
      const norm = (body: any) => ({
        ...body,
        design_work_orders: body.design_work_orders.map((r: any) => ({
          ...r,
          created_at: new Date(r.created_at).toISOString(),
          runs: [...r.runs].sort((a: any, b: any) => a.id.localeCompare(b.id)),
        })),
      })
      expect(norm(got.on.all)).toEqual(norm(got.off.all))

      // The marker: change the work_order row ONLY. The flag-on read sees it.
      const service: any = getContainer().resolve(WORK_ORDER_MODULE)
      await service.updateWorkOrders({ id: collated.orderId, partner_status: "finished" })
      const after = await bothWays(
        async () => (await read(`&id=${collated.orderId}`)).design_work_orders[0].partner_status
      )
      expect(after.on).toBe("finished")
      expect(after.off).not.toBe("finished")
    })

    // ------------------------------------------------------ PROD GATE JOB --

    it("work-order-parity (full run): 0 mismatches, 0 missing, 0 admin-list differences", async () => {
      // The job the flag flip is gated on (run read-only on prod). A full run
      // also compares the admin lists flag off vs on.
      const r = await workOrderParityJob.run(getContainer(), { dry_run: true, params: {} })
      expect({ changes: r.changes }).toEqual({ changes: [] })
      expect(r.summary).toMatch(/ 0 mismatch, 0 missing a work_order; admin lists: .* 0 list difference\(s\)$/)
    })

    it("work-order-parity names an order the two admin lists disagree on", async () => {
      // Drop the collated order's work_order: flag on would lose it from
      // kind=design. (The channel still keeps it out of retail.)
      const service: any = getContainer().resolve(WORK_ORDER_MODULE)
      await service.deleteWorkOrders([collated.orderId])
      const r = await workOrderParityJob.run(getContainer(), { dry_run: true, params: {} })
      expect(r.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: collated.orderId, field: "list:design", after: "not listed" }),
        ])
      )
      expect(r.changes.some((c: any) => c.field === "list:retail_excluded")).toBe(false)
    })

    // --------------------------------------------------------------- STATS --

    it("stats: orders counts retail only; work orders are counted apart", async () => {
      const stats = (await get(`/admin/mcp/stats`)).stats
      const retailCount = (await get(`/admin/orders?kind=retail&limit=1`)).count
      const workCount =
        (await get(`/admin/orders?kind=design&limit=1`)).count +
        (await get(`/admin/orders?kind=inventory&limit=1`)).count
      expect(stats.orders).toBe(retailCount)
      expect(stats.work_orders).toBe(workCount)
      expect(stats.work_orders).toBeGreaterThanOrEqual(3)
    })
  })
})

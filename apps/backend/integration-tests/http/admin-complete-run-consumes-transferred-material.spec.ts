/**
 * Completing a run takes the material it used off OUR stock — from the admin
 * door too, and for cloth we transferred to the partner's own warehouse.
 *
 * The prod case, 2026-11-04: Prince Tailors' denim trouser run. Our 13.3 m of
 * handloom denim had reached Prince's warehouse through admin material
 * transfers out of Dharamshala; the run had no material allocation. The admin
 * door could not say what the run used, so the 6.45 m was logged and committed
 * by hand afterwards — and the deduction then skipped it as "partner-held",
 * leaving Prince's level at 12.3 m until it was corrected by hand.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

const PASSWORD = "supersecret"

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("admin completion consumes material we transferred to the partner", () => {
    let adminHeaders: any
    let unique: number

    const post = async (url: string, body: any, cfg?: any) => {
      try {
        return await api.post(url, body, cfg ?? adminHeaders)
      } catch (err: any) {
        throw new Error(
          `POST ${url} failed: ${err?.response?.status} ${JSON.stringify(err?.response?.data)}`
        )
      }
    }

    const stockAt = async (itemId: string, locationId: string) => {
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "inventory_level",
        fields: ["stocked_quantity"],
        filters: { inventory_item_id: itemId, location_id: locationId },
      })
      return Number(data?.[0]?.stocked_quantity ?? 0)
    }

    /** The apply runs in a subscriber after the commit — wait for it to settle. */
    const settledStockAt = async (itemId: string, locationId: string, expected: number) => {
      let last = NaN
      for (let i = 0; i < 40; i++) {
        last = await stockAt(itemId, locationId)
        if (Math.abs(last - expected) < 1e-9) return last
        await new Promise((r) => setTimeout(r, 250))
      }
      return last
    }

    const runLogs = async (runId: string) => {
      const service: any = getContainer().resolve("consumption_log")
      return service.listConsumptionLogs({ production_run_id: runId })
    }

    /** Partner + its own warehouse, our core warehouse, an item and a run in progress. */
    const seed = async () => {
      unique = Date.now() + Math.floor(Math.random() * 1000)
      const email = `consume-transfer-${unique}@jyt.test`
      await post("/auth/partner/emailpass/register", { email, password: PASSWORD }, {})
      const login = await post("/auth/partner/emailpass", { email, password: PASSWORD }, {})
      const partner = await post(
        "/partners",
        {
          name: `Consume Transfer ${unique}`,
          handle: `consume-transfer-${unique}`,
          admin: { email, first_name: "C", last_name: "T" },
        },
        { headers: { Authorization: `Bearer ${login.data.token}` } }
      )
      const partnerId = partner.data.partner.id as string

      const ours = (await post("/admin/stock-locations", { name: `Ours ${unique}` })).data
        .stock_location.id as string
      const bench = (await post("/admin/stock-locations", { name: `Bench ${unique}` })).data
        .stock_location.id as string
      await post("/admin/location-ownership", { stock_location_id: ours, is_core: true })
      await post("/admin/location-ownership", { stock_location_id: bench, is_core: false })
      const link: any = getContainer().resolve(ContainerRegistrationKeys.LINK)
      await link.create([
        {
          [PARTNER_MODULE]: { partner_id: partnerId },
          [Modules.STOCK_LOCATION]: { stock_location_id: bench },
        },
      ])

      const item = (
        await post("/admin/inventory-items", { title: "Handloom denim", sku: `denim-${unique}` })
      ).data.inventory_item.id as string

      const design = await post("/admin/designs", {
        name: `Denim trousers ${unique}`,
        description: "x",
        design_type: "Original",
        status: "Approved",
        priority: "Medium",
      })
      const run = await post("/admin/production-runs", {
        design_id: design.data.design.id,
        partner_id: partnerId,
        quantity: 3,
      })
      const runId = run.data.production_run.id as string
      const runService: any = getContainer().resolve("production_runs")
      await runService.updateProductionRuns({ id: runId, status: "in_progress" })

      return { partnerId, ours, bench, item, runId }
    }

    const completeWithDenim = (runId: string, item: string) =>
      post(`/admin/production-runs/${runId}/complete`, {
        produced_quantity: 3,
        partner_cost_estimate: 780,
        cost_type: "per_unit",
        consumptions: [
          {
            inventory_item_id: item,
            quantity: 6.45,
            quantity_basis: "total",
            unit_cost: 600,
            unit_of_measure: "Meter",
          },
        ],
      })

    beforeAll(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    it("logs the admin's material, commits it, and takes it off the partner's bench", async () => {
      const { ours, bench, item, runId } = await seed()

      // Our cloth: stocked with us, then transferred to the partner and counted in.
      await post(`/admin/inventory-items/${item}/location-levels`, {
        location_id: ours,
        stocked_quantity: 13,
      })
      const transfer = await post("/admin/inventory-transfers", {
        inventory_item_id: item,
        from_location_id: ours,
        to_location_id: bench,
        quantity: 13,
      })
      const transferId = transfer.data.material_transfer.id
      await post(`/admin/inventory-transfers/${transferId}/receive`, {})
      expect(await stockAt(item, bench)).toBe(13)

      const res = await completeWithDenim(runId, item)
      expect(res.status).toBe(200)
      expect(res.data.consumptions_logged).toBe(1)

      const [log] = await runLogs(runId)
      expect(log).toMatchObject({
        consumed_by: "admin",
        is_committed: true,
        quantity: 6.45,
        quantity_basis: "total",
        unit_cost: 600,
      })

      expect(await settledStockAt(item, bench, 6.55)).toBeCloseTo(6.55, 6)
      expect(await stockAt(item, ours)).toBe(0)
    })

    it("leaves the partner's own cloth alone — no transfer of ours reached that bench", async () => {
      const { bench, item, runId } = await seed()
      await post(`/admin/inventory-items/${item}/location-levels`, {
        location_id: bench,
        stocked_quantity: 10,
      })

      const res = await completeWithDenim(runId, item)
      expect(res.status).toBe(200)

      const [log] = await runLogs(runId)
      expect(log.is_committed).toBe(true)

      // Give the subscriber time to have run, then confirm nothing moved.
      await new Promise((r) => setTimeout(r, 3000))
      expect(await stockAt(item, bench)).toBe(10)
    })
  })
})

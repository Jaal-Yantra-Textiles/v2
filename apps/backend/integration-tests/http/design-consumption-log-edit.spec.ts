import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { DESIGN_MODULE } from "../../src/modules/designs"
import { CONSUMPTION_LOG_MODULE } from "../../src/modules/consumption_log"
import { OPS_AUDIT_MODULE } from "../../src/modules/ops_audit"

jest.setTimeout(180 * 1000)

/**
 * Correcting a consumption log.
 *
 * ## Why this route had to exist
 *
 * There was no edit path. The design and run consumption routes are POST + GET;
 * `updateConsumptionLogs` was reachable only from the commit flow and two ops
 * jobs. So the figure that decides BOTH stock deduction and design cost could
 * be recorded wrong and then only ever added to.
 *
 * 🔴 The case that surfaced it: one garment cut from muslin (2 m) and two from
 * kala cotton (2 m each) — 6 m over 3 pieces — recorded as two `per_piece`
 * logs of 2. `per_piece × pieces` applies ONE piece count to EVERY material,
 * so applying those would have deducted 2×3 and 2×3 = 12 m. Exactly double,
 * and silently, because nothing in the pipeline compares a deduction to what
 * anyone believed was used.
 */

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("PATCH/DELETE /admin/designs/:id/consumption-logs/:logId", () => {
    let headers: any
    let designId: string

    const logs = () => getContainer().resolve(CONSUMPTION_LOG_MODULE) as any

    const seedLog = async (over: Record<string, any> = {}) =>
      await logs().createConsumptionLogs({
        design_id: designId,
        inventory_item_id: `iitem_${Date.now()}${Math.floor(Math.random() * 1e5)}`,
        quantity: 2,
        quantity_basis: "per_piece",
        unit_of_measure: "Meter",
        consumption_type: "sample",
        is_committed: true,
        consumed_by: "admin",
        consumed_at: new Date(),
        ...over,
      })

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      headers = await getAuthHeaders(api)

      const designs: any = container.resolve(DESIGN_MODULE)
      const design = await designs.createDesigns({
        name: `Consumption Edit ${Date.now()}`,
        description: "fixture",
        design_type: "Custom",
        status: "Conceptual",
      })
      designId = (Array.isArray(design) ? design[0] : design).id
    })

    it("🔴 corrects a per_piece basis to total — the multiple, not the magnitude", async () => {
      const log = await seedLog({ quantity: 2, quantity_basis: "per_piece" })

      const res = await api.patch(
        `/admin/designs/${designId}/consumption-logs/${log.id}`,
        { quantity: 4, quantity_basis: "total" },
        headers
      )

      expect(res.status).toBe(200)
      expect(res.data.consumption_log.quantity).toBe(4)
      expect(res.data.consumption_log.quantity_basis).toBe("total")

      // Read back from the service, not the echo — a 200 that echoes the
      // request body proves nothing about what was stored.
      const fresh = await logs().retrieveConsumptionLog(log.id)
      expect(Number(fresh.quantity)).toBe(4)
      expect(fresh.quantity_basis).toBe("total")
    })

    it("🔴 REFUSES a log whose stock movement already happened", async () => {
      const log = await seedLog({
        inventory_applied_at: new Date(),
      })

      const err = await api
        .patch(
          `/admin/designs/${designId}/consumption-logs/${log.id}`,
          { quantity: 99 },
          headers
        )
        .catch((e: any) => e.response)

      // Once stock has moved the number describes a decrement that occurred.
      // Editing it leaves the log and the stock level disagreeing with nothing
      // to reconcile them — that needs a reversing entry, not an edit.
      expect(err.status).toBe(400)
      expect(String(err.data?.message ?? "")).toMatch(/reversing entry/i)

      const fresh = await logs().retrieveConsumptionLog(log.id)
      expect(Number(fresh.quantity)).toBe(2)
    })

    it("🔴 refuses a log belonging to another design", async () => {
      const designs: any = getContainer().resolve(DESIGN_MODULE)
      const other = await designs.createDesigns({
        name: `Other ${Date.now()}`,
        description: "fixture",
        design_type: "Custom",
        status: "Conceptual",
      })
      const otherId = (Array.isArray(other) ? other[0] : other).id
      const log = await seedLog()

      // Without the ownership check a log is editable through ANY design's URL.
      const err = await api
        .patch(
          `/admin/designs/${otherId}/consumption-logs/${log.id}`,
          { quantity: 9 },
          headers
        )
        .catch((e: any) => e.response)

      expect(err.status).toBe(404)
    })

    it("refuses an empty correction rather than silently no-opping", async () => {
      const log = await seedLog()
      const err = await api
        .patch(`/admin/designs/${designId}/consumption-logs/${log.id}`, {}, headers)
        .catch((e: any) => e.response)

      expect(err.status).toBe(400)
    })

    it("retires a duplicate, and writes an ops audit row carrying before/after", async () => {
      const log = await seedLog({ quantity: 2 })

      const res = await api.delete(
        `/admin/designs/${designId}/consumption-logs/${log.id}`,
        headers
      )
      expect(res.status).toBe(200)
      expect(res.data.deleted).toBe(true)

      const gone = await logs().retrieveConsumptionLog(log.id).catch(() => null)
      expect(gone).toBeNull()

      // 🔑 A corrected material figure must be traceable to who changed it and
      // from what — that is the whole reason an edit path is safe to have.
      const audit: any = getContainer().resolve(OPS_AUDIT_MODULE)
      const [rows] = await audit.listAndCountOpsMaintenanceRuns(
        { job_id: "admin.consumption-log.delete" },
        { order: { created_at: "DESC" }, take: 5 }
      )
      const mine = (rows ?? []).find(
        (r: any) => r.params?.consumption_log_id === log.id
      )
      expect(mine).toBeTruthy()
      expect(mine.applied).toBe(true)
      expect(mine.changes?.[0]?.before?.id).toBe(log.id)
      expect(mine.changes?.[0]?.after).toBeNull()
    })
  })
})

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(60 * 1000)

/**
 * #508 — Data Plumbing v2 per-run detail endpoint (UI redesign slice):
 *   GET /admin/ops/maintenance-jobs/runs/:id → one persisted
 *   `ops_maintenance_run` with its `changes`/`errors` (+ `batch_id`/`job_index`
 *   when it ran in a batch). 404 on unknown id; backs the deep-linkable run
 *   detail route the history table drills into.
 *
 * Seeds a run by APPLYing an empty-DB-safe job (dry_run:false persists a row),
 * then reads it back by id.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("admin ops maintenance-jobs run detail (#508)", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    it("GET /runs/:id returns the persisted run with its changes/errors", async () => {
      // Apply a no-op-safe job so a run row is persisted (dry-runs are not).
      const applied = await api.post(
        "/admin/ops/maintenance-jobs/backfill-inventory-unit-cost/run",
        { dry_run: false, params: {} },
        adminHeaders
      )
      expect(applied.status).toBe(200)

      // Grab the run we just persisted from the (newest-first) history.
      const list = await api.get(
        "/admin/ops/maintenance-jobs/runs?job_id=backfill-inventory-unit-cost&limit=1",
        adminHeaders
      )
      expect(list.status).toBe(200)
      expect(list.data.runs.length).toBe(1)
      const runId = list.data.runs[0].id as string

      const res = await api.get(
        `/admin/ops/maintenance-jobs/runs/${runId}`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.run.id).toBe(runId)
      expect(res.data.run.job_id).toBe("backfill-inventory-unit-cost")
      expect(Array.isArray(res.data.run.changes)).toBe(true)
      expect(res.data.run.dry_run).toBe(false)
    })

    it("GET /runs/:id returns 404 for an unknown run id", async () => {
      await expect(
        api.get(
          "/admin/ops/maintenance-jobs/runs/omr_does_not_exist",
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 404 } })
    })

    it("GET /runs/:id requires admin auth → 401", async () => {
      await expect(
        api.get("/admin/ops/maintenance-jobs/runs/omr_anything")
      ).rejects.toMatchObject({ response: { status: 401 } })
    })
  })
})

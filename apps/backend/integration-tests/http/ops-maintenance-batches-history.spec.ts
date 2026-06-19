import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(60 * 1000)

/**
 * #508 — Data Plumbing v2 batch-run HISTORY endpoints (slice 3):
 *   - GET /admin/ops/maintenance-jobs/batches        → paginated index of
 *     `ops_maintenance_batch` parents (newest first; dry_run/actor_id filters).
 *   - GET /admin/ops/maintenance-jobs/batches/:id     → one batch + its child
 *     `ops_maintenance_run` rows in `job_index` order (404 on unknown id).
 *
 * Seeds history by POSTing real batches (the slice-2 run endpoint) with empty-DB
 * safe jobs, then reads it back. Mirrors the `/runs` reader envelope.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("admin ops maintenance-jobs batch history (#508)", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    const runBatch = async (body: Record<string, unknown>) => {
      const res = await api.post(
        "/admin/ops/maintenance-jobs/batches",
        body,
        adminHeaders
      )
      expect(res.status).toBe(200)
      return res.data.batch.id as string
    }

    it("GET /batches lists batch parents newest-first with the list envelope", async () => {
      const firstId = await runBatch({
        name: "history batch one",
        jobs: [{ job_id: "backfill-inventory-unit-cost" }],
      })
      const secondId = await runBatch({
        name: "history batch two",
        jobs: [
          { job_id: "backfill-inventory-unit-cost" },
          { job_id: "backfill-design-energy-costs" },
        ],
      })

      const res = await api.get(
        "/admin/ops/maintenance-jobs/batches?limit=50",
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data).toMatchObject({ limit: 50, offset: 0 })
      expect(typeof res.data.count).toBe("number")
      expect(Array.isArray(res.data.batches)).toBe(true)

      const ids = res.data.batches.map((b: any) => b.id)
      expect(ids).toContain(firstId)
      expect(ids).toContain(secondId)

      // Newest-first: the later batch sorts ahead of the earlier one.
      expect(ids.indexOf(secondId)).toBeLessThan(ids.indexOf(firstId))

      const second = res.data.batches.find((b: any) => b.id === secondId)
      expect(second.name).toBe("history batch two")
      expect(second.job_count).toBe(2)
      expect(second.dry_run).toBe(true)
    })

    it("GET /batches?dry_run=false filters to applied batches only", async () => {
      const previewId = await runBatch({
        name: "preview only",
        dry_run: true,
        jobs: [{ job_id: "backfill-inventory-unit-cost" }],
      })
      const appliedId = await runBatch({
        name: "applied run",
        dry_run: false,
        jobs: [{ job_id: "backfill-inventory-unit-cost" }],
      })

      const res = await api.get(
        "/admin/ops/maintenance-jobs/batches?dry_run=false&limit=50",
        adminHeaders
      )
      expect(res.status).toBe(200)
      const ids = res.data.batches.map((b: any) => b.id)
      expect(ids).toContain(appliedId)
      expect(ids).not.toContain(previewId)
      expect(res.data.batches.every((b: any) => b.dry_run === false)).toBe(true)
    })

    it("GET /batches/:id returns the batch + its child runs in job_index order", async () => {
      const batchId = await runBatch({
        name: "detail check",
        jobs: [
          { job_id: "backfill-inventory-unit-cost" },
          {
            job_id: "recalculate-design-cost",
            params: { design_id: "design_does_not_exist" },
          },
          { job_id: "backfill-design-energy-costs" },
        ],
      })

      const res = await api.get(
        `/admin/ops/maintenance-jobs/batches/${batchId}`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.batch.id).toBe(batchId)
      expect(res.data.batch.name).toBe("detail check")
      expect(res.data.batch.job_count).toBe(3)
      expect(res.data.batch.failed_count).toBe(1)

      expect(Array.isArray(res.data.jobs)).toBe(true)
      expect(res.data.jobs).toHaveLength(3)
      // Children are ordered by job_index ascending.
      expect(res.data.jobs.map((j: any) => j.job_index)).toEqual([0, 1, 2])
      expect(res.data.jobs.every((j: any) => j.batch_id === batchId)).toBe(true)

      const failed = res.data.jobs[1]
      expect(failed.job_id).toBe("recalculate-design-cost")
      expect(failed.applied).toBe(false)
      expect(failed.error_count).toBe(1)
    })

    it("GET /batches/:id with an unknown id → 404", async () => {
      await expect(
        api.get(
          "/admin/ops/maintenance-jobs/batches/batch_does_not_exist",
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 404 } })
    })

    it("requires admin auth (401 without headers)", async () => {
      await expect(
        api.get("/admin/ops/maintenance-jobs/batches")
      ).rejects.toMatchObject({ response: { status: 401 } })
    })
  })
})

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(60 * 1000)

/**
 * #508 — Data Plumbing v2 batch run endpoint (POST /admin/ops/maintenance-jobs/
 * batches). Stateless "A2": one call runs + records the whole batch.
 *
 * Covers the validator guards (empty jobs / >MAX_BATCH_JOBS / unknown id → 400),
 * the safe-by-default dry_run, and — the core #508 contract — that a child job
 * which throws is CAUGHT and recorded (continue-on-error) without aborting the
 * request, while `stop_on_error` halts the rest. The clean children use the
 * empty-DB safe jobs (no heavy seeding); the failing child uses a missing
 * design id, which `recalculate-design-cost` rejects with NOT_FOUND.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("admin ops maintenance-jobs batches (#508)", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    it("POST /batches with an empty jobs array → 400", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/batches",
          { dry_run: true, jobs: [] },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })

    it("POST /batches over the per-batch job cap → 400", async () => {
      const jobs = Array.from({ length: 21 }, () => ({
        job_id: "backfill-inventory-unit-cost",
      }))
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/batches",
          { dry_run: true, jobs },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })

    it("POST /batches with an unknown job id → 400 (validated up front)", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/batches",
          {
            dry_run: true,
            jobs: [
              { job_id: "backfill-inventory-unit-cost" },
              { job_id: "no-such-job" },
            ],
          },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })

    it("runs a clean 2-job dry-run batch (safe-by-default) and rolls it up", async () => {
      const res = await api.post(
        "/admin/ops/maintenance-jobs/batches",
        {
          name: "tenant cleanup preview",
          jobs: [
            { job_id: "backfill-inventory-unit-cost" },
            { job_id: "backfill-design-energy-costs" },
          ],
        },
        adminHeaders
      )

      expect(res.status).toBe(200)
      expect(res.data.batch.id).toBeTruthy()
      expect(res.data.batch.name).toBe("tenant cleanup preview")
      expect(res.data.batch.dry_run).toBe(true)
      expect(res.data.batch.job_count).toBe(2)
      expect(res.data.batch.applied_count).toBe(0)
      expect(res.data.batch.failed_count).toBe(0)
      expect(res.data.batch.summary).toMatch(/Previewed 2 job\(s\)/)

      expect(res.data.results).toHaveLength(2)
      expect(res.data.results.every((r: any) => r.ok)).toBe(true)
      expect(res.data.results.map((r: any) => r.job_index)).toEqual([0, 1])
      expect(res.data.results[0].result.job_id).toBe("backfill-inventory-unit-cost")
    })

    it("CATCHES a failing child and continues the batch (continue-on-error default)", async () => {
      const res = await api.post(
        "/admin/ops/maintenance-jobs/batches",
        {
          jobs: [
            { job_id: "backfill-inventory-unit-cost" },
            {
              job_id: "recalculate-design-cost",
              params: { design_id: "design_does_not_exist" },
            },
            { job_id: "backfill-design-energy-costs" },
          ],
        },
        adminHeaders
      )

      // The thrown NOT_FOUND child did NOT abort the request.
      expect(res.status).toBe(200)
      expect(res.data.results).toHaveLength(3)
      expect(res.data.results[0].ok).toBe(true)
      expect(res.data.results[1].ok).toBe(false)
      expect(res.data.results[1].job_id).toBe("recalculate-design-cost")
      expect(res.data.results[1].error).toMatch(/not found/i)
      expect(res.data.results[2].ok).toBe(true)

      expect(res.data.batch.job_count).toBe(3)
      expect(res.data.batch.failed_count).toBe(1)
    })

    it("halts the rest of the batch when stop_on_error=true", async () => {
      const res = await api.post(
        "/admin/ops/maintenance-jobs/batches",
        {
          stop_on_error: true,
          jobs: [
            {
              job_id: "recalculate-design-cost",
              params: { design_id: "design_does_not_exist" },
            },
            { job_id: "backfill-inventory-unit-cost" },
          ],
        },
        adminHeaders
      )

      expect(res.status).toBe(200)
      // Second job never ran — only the failing first child is recorded.
      expect(res.data.results).toHaveLength(1)
      expect(res.data.results[0].ok).toBe(false)
      expect(res.data.batch.job_count).toBe(1)
      expect(res.data.batch.failed_count).toBe(1)
    })

    it("persists the batch children as ops_maintenance_run rows tied via batch_id", async () => {
      const runRes = await api.post(
        "/admin/ops/maintenance-jobs/batches",
        {
          name: "audit linkage check",
          jobs: [
            { job_id: "backfill-inventory-unit-cost" },
            {
              job_id: "recalculate-design-cost",
              params: { design_id: "design_does_not_exist" },
            },
          ],
        },
        adminHeaders
      )
      expect(runRes.status).toBe(200)
      const batchId = runRes.data.batch.id
      expect(batchId).toBeTruthy()

      // The two children surface in the (v1) run-history reader.
      const runs = await api.get(
        "/admin/ops/maintenance-jobs/runs?limit=100",
        adminHeaders
      )
      expect(runs.status).toBe(200)
      const children = runs.data.runs.filter((r: any) => r.batch_id === batchId)
      expect(children).toHaveLength(2)

      const failed = children.find(
        (r: any) => r.job_id === "recalculate-design-cost"
      )
      expect(failed).toBeDefined()
      expect(failed.applied).toBe(false)
      expect(failed.error_count).toBe(1)
      expect(typeof failed.job_index).toBe("number")
    })

    it("requires admin auth (401 without headers)", async () => {
      await expect(
        api.post("/admin/ops/maintenance-jobs/batches", {
          jobs: [{ job_id: "backfill-inventory-unit-cost" }],
        })
      ).rejects.toMatchObject({ response: { status: 401 } })
    })
  })
})

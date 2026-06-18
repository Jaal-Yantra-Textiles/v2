import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(60 * 1000)

/**
 * #457 — Admin data-plumbing / ops maintenance jobs (backend API layer).
 *
 * Covers the registry discovery endpoint + the run endpoint's guard rails
 * (unknown job → 404, missing required param → 400, missing design → 404) and
 * the safe-by-default dry_run behaviour. The full recalc-with-real-data path is
 * unit-tested via diffCostFields; here we assert the API contract + guards
 * without heavy BOM/production-run seeding.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("admin ops maintenance jobs", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    it("GET /admin/ops/maintenance-jobs lists the recalculate-design-cost job", async () => {
      const res = await api.get("/admin/ops/maintenance-jobs", adminHeaders)
      expect(res.status).toBe(200)
      expect(res.data.count).toBeGreaterThanOrEqual(1)

      const recalc = res.data.jobs.find(
        (j: any) => j.id === "recalculate-design-cost"
      )
      expect(recalc).toBeDefined()
      expect(recalc.label).toBeTruthy()
      expect(recalc.description).toBeTruthy()
      expect(recalc.params).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "design_id", required: true }),
        ])
      )
    })

    it("POST run with an unknown job id → 404", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/no-such-job/run",
          { dry_run: true },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 404 } })
    })

    it("POST recalculate-design-cost without design_id → 400", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/recalculate-design-cost/run",
          { dry_run: true, params: {} },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })

    it("POST recalculate-design-cost for a missing design → 404 (before any compute)", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/recalculate-design-cost/run",
          { dry_run: true, params: { design_id: "design_does_not_exist" } },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 404 } })
    })

    it("GET lists the bulk recalculate job alongside the single one", async () => {
      const res = await api.get("/admin/ops/maintenance-jobs", adminHeaders)
      expect(res.status).toBe(200)
      const ids = res.data.jobs.map((j: any) => j.id)
      expect(ids).toEqual(
        expect.arrayContaining([
          "recalculate-design-cost",
          "recalculate-design-cost-bulk",
        ])
      )
      const bulk = res.data.jobs.find(
        (j: any) => j.id === "recalculate-design-cost-bulk"
      )
      expect(bulk.params).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "design_ids", required: true }),
        ])
      )
    })

    it("POST recalculate-design-cost-bulk without design_ids → 400", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/recalculate-design-cost-bulk/run",
          { dry_run: true, params: {} },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })

    it("POST recalculate-design-cost-bulk reports a missing id per-design instead of failing the batch", async () => {
      const res = await api.post(
        "/admin/ops/maintenance-jobs/recalculate-design-cost-bulk/run",
        { dry_run: true, params: { design_ids: ["design_does_not_exist"] } },
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.result.dry_run).toBe(true)
      expect(res.data.result.applied).toBe(false)
      expect(res.data.result.changes).toEqual([])
      expect(res.data.result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "design_does_not_exist" }),
        ])
      )
    })

    it("requires admin auth (401 without headers)", async () => {
      await expect(
        api.get("/admin/ops/maintenance-jobs")
      ).rejects.toMatchObject({ response: { status: 401 } })
    })
  })
})

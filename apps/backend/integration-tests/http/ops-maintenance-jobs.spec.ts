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

    it("GET lists the correct-production-run-cost job", async () => {
      const res = await api.get("/admin/ops/maintenance-jobs", adminHeaders)
      expect(res.status).toBe(200)
      const job = res.data.jobs.find(
        (j: any) => j.id === "correct-production-run-cost"
      )
      expect(job).toBeDefined()
      expect(job.params).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "production_run_id", required: true }),
          expect.objectContaining({ name: "partner_cost_estimate", required: false }),
          expect.objectContaining({ name: "cost_type", required: false }),
        ])
      )
    })

    it("POST correct-production-run-cost without production_run_id → 400", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/correct-production-run-cost/run",
          { dry_run: true, params: { cost_type: "per_unit" } },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })

    it("POST correct-production-run-cost with no cost field to change → 400", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/correct-production-run-cost/run",
          { dry_run: true, params: { production_run_id: "prod_run_x" } },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })

    it("POST correct-production-run-cost with an invalid cost_type → 400", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/correct-production-run-cost/run",
          {
            dry_run: true,
            params: { production_run_id: "prod_run_x", cost_type: "bogus" },
          },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })

    it("POST correct-production-run-cost for a missing run → 404 (before any write)", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/correct-production-run-cost/run",
          {
            dry_run: true,
            params: { production_run_id: "prod_run_missing", cost_type: "per_unit" },
          },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 404 } })
    })

    it("GET lists the backfill-inventory-unit-cost job with optional params", async () => {
      const res = await api.get("/admin/ops/maintenance-jobs", adminHeaders)
      expect(res.status).toBe(200)
      const job = res.data.jobs.find(
        (j: any) => j.id === "backfill-inventory-unit-cost"
      )
      expect(job).toBeDefined()
      expect(job.label).toBeTruthy()
      expect(job.description).toBeTruthy()
      expect(job.params).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "force", required: false }),
          expect.objectContaining({ name: "limit", required: false }),
        ])
      )
    })

    it("POST backfill-inventory-unit-cost with no params is safe-by-default dry_run (empty DB → no changes)", async () => {
      const res = await api.post(
        "/admin/ops/maintenance-jobs/backfill-inventory-unit-cost/run",
        {},
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.result.job_id).toBe("backfill-inventory-unit-cost")
      expect(res.data.result.dry_run).toBe(true)
      expect(res.data.result.applied).toBe(false)
      expect(res.data.result.changes).toEqual([])
      expect(res.data.result.summary).toMatch(/scanned/i)
      expect(res.data.audit.job_id).toBe("backfill-inventory-unit-cost")
    })

    it("POST backfill-inventory-unit-cost rejects an invalid limit → 400", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/backfill-inventory-unit-cost/run",
          { dry_run: true, params: { limit: -5 } },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })

    it("GET lists the backfill-design-energy-costs job with optional params", async () => {
      const res = await api.get("/admin/ops/maintenance-jobs", adminHeaders)
      expect(res.status).toBe(200)
      const job = res.data.jobs.find(
        (j: any) => j.id === "backfill-design-energy-costs"
      )
      expect(job).toBeDefined()
      expect(job.label).toBeTruthy()
      expect(job.description).toBeTruthy()
      expect(job.params).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "design_id", required: false }),
          expect.objectContaining({ name: "force", required: false }),
          expect.objectContaining({ name: "limit", required: false }),
        ])
      )
    })

    it("POST backfill-design-energy-costs with no params is safe-by-default dry_run (empty DB → no changes)", async () => {
      const res = await api.post(
        "/admin/ops/maintenance-jobs/backfill-design-energy-costs/run",
        {},
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.result.job_id).toBe("backfill-design-energy-costs")
      expect(res.data.result.dry_run).toBe(true)
      expect(res.data.result.applied).toBe(false)
      expect(res.data.result.changes).toEqual([])
      expect(res.data.result.summary).toMatch(/scanned/i)
    })

    it("POST backfill-design-energy-costs reports a missing design_id per-design instead of failing", async () => {
      const res = await api.post(
        "/admin/ops/maintenance-jobs/backfill-design-energy-costs/run",
        { dry_run: true, params: { design_id: "design_does_not_exist" } },
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.result.dry_run).toBe(true)
      expect(res.data.result.changes).toEqual([])
      expect(res.data.result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "design_does_not_exist" }),
        ])
      )
    })

    it("POST backfill-design-energy-costs rejects an invalid limit → 400", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/backfill-design-energy-costs/run",
          { dry_run: true, params: { limit: -5 } },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })

    it("requires admin auth (401 without headers)", async () => {
      await expect(
        api.get("/admin/ops/maintenance-jobs")
      ).rejects.toMatchObject({ response: { status: 401 } })
    })

    // #457 — durable audit log
    it("persists an audit row per run and exposes it via GET /runs", async () => {
      // A bulk dry-run against a missing id succeeds (200, per-design error) and
      // is a clean audit seed that needs no real design data.
      const runRes = await api.post(
        "/admin/ops/maintenance-jobs/recalculate-design-cost-bulk/run",
        { dry_run: true, params: { design_ids: ["design_does_not_exist"] } },
        adminHeaders
      )
      expect(runRes.status).toBe(200)

      const res = await api.get(
        "/admin/ops/maintenance-jobs/runs",
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.count).toBeGreaterThanOrEqual(1)
      expect(res.data.limit).toBe(20)
      expect(res.data.offset).toBe(0)

      const row = res.data.runs.find(
        (r: any) => r.job_id === "recalculate-design-cost-bulk"
      )
      expect(row).toBeDefined()
      expect(row.dry_run).toBe(true)
      expect(row.applied).toBe(false)
      expect(row.change_count).toBe(0)
      expect(row.error_count).toBeGreaterThanOrEqual(1)
      expect(Array.isArray(row.errors)).toBe(true)
      expect(row.created_at).toBeTruthy()
    })

    it("GET /runs filters by job_id", async () => {
      await api.post(
        "/admin/ops/maintenance-jobs/recalculate-design-cost-bulk/run",
        { dry_run: true, params: { design_ids: ["design_does_not_exist"] } },
        adminHeaders
      )

      const res = await api.get(
        "/admin/ops/maintenance-jobs/runs?job_id=recalculate-design-cost-bulk&dry_run=true",
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.runs.length).toBeGreaterThanOrEqual(1)
      for (const r of res.data.runs) {
        expect(r.job_id).toBe("recalculate-design-cost-bulk")
        expect(r.dry_run).toBe(true)
      }
    })

    it("GET /runs requires admin auth (401 without headers)", async () => {
      await expect(
        api.get("/admin/ops/maintenance-jobs/runs")
      ).rejects.toMatchObject({ response: { status: 401 } })
    })

    // #457 — audit-log retention/pruning job
    it("GET lists the prune-ops-audit-runs job with a required older_than_days param", async () => {
      const res = await api.get("/admin/ops/maintenance-jobs", adminHeaders)
      expect(res.status).toBe(200)
      const job = res.data.jobs.find((j: any) => j.id === "prune-ops-audit-runs")
      expect(job).toBeDefined()
      expect(job.label).toBeTruthy()
      expect(job.description).toBeTruthy()
      expect(job.params).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "older_than_days", required: true }),
          expect.objectContaining({ name: "include_applied", required: false }),
          expect.objectContaining({ name: "limit", required: false }),
        ])
      )
    })

    it("POST prune-ops-audit-runs without older_than_days → 400", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/prune-ops-audit-runs/run",
          { dry_run: true, params: {} },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })

    it("POST prune-ops-audit-runs rejects a non-positive older_than_days → 400", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/prune-ops-audit-runs/run",
          { dry_run: true, params: { older_than_days: 0 } },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })

    it("POST prune-ops-audit-runs is safe-by-default dry_run and never prunes fresh rows", async () => {
      // Seed one audit row (its created_at ≈ now), then prune with a wide window:
      // the cutoff is in the past, so the fresh row must NOT match → 0 changes.
      await api.post(
        "/admin/ops/maintenance-jobs/recalculate-design-cost-bulk/run",
        { dry_run: true, params: { design_ids: ["design_does_not_exist"] } },
        adminHeaders
      )

      const res = await api.post(
        "/admin/ops/maintenance-jobs/prune-ops-audit-runs/run",
        { params: { older_than_days: 3650 } },
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.result.job_id).toBe("prune-ops-audit-runs")
      expect(res.data.result.dry_run).toBe(true)
      expect(res.data.result.applied).toBe(false)
      expect(res.data.result.changes).toEqual([])
      expect(res.data.result.summary).toMatch(/no .*audit rows older than 3650 day/i)

      // The seed row is still there afterwards (nothing was deleted).
      const runs = await api.get(
        "/admin/ops/maintenance-jobs/runs?job_id=recalculate-design-cost-bulk",
        adminHeaders
      )
      expect(runs.data.count).toBeGreaterThanOrEqual(1)
    })

    // #485 — partner order currency backfill
    it("GET lists the backfill-partner-order-currency job with optional params", async () => {
      const res = await api.get("/admin/ops/maintenance-jobs", adminHeaders)
      expect(res.status).toBe(200)
      const job = res.data.jobs.find(
        (j: any) => j.id === "backfill-partner-order-currency"
      )
      expect(job).toBeDefined()
      expect(job.label).toBeTruthy()
      expect(job.description).toBeTruthy()
      expect(job.params).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "partner_id", required: false }),
          expect.objectContaining({ name: "from_currency", required: false }),
          expect.objectContaining({ name: "limit", required: false }),
        ])
      )
    })

    it("POST backfill-partner-order-currency with no params is safe-by-default dry_run (no partners → no changes)", async () => {
      const res = await api.post(
        "/admin/ops/maintenance-jobs/backfill-partner-order-currency/run",
        {},
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.result.job_id).toBe("backfill-partner-order-currency")
      expect(res.data.result.dry_run).toBe(true)
      expect(res.data.result.applied).toBe(false)
      expect(res.data.result.changes).toEqual([])
      expect(res.data.result.summary).toMatch(/scanned/i)
    })

    it("POST backfill-partner-order-currency rejects an invalid limit → 400", async () => {
      await expect(
        api.post(
          "/admin/ops/maintenance-jobs/backfill-partner-order-currency/run",
          { dry_run: true, params: { limit: -5 } },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })
  })
})

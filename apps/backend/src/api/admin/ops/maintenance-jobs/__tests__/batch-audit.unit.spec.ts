import { buildBatchRollup } from "../batch-audit"
import type { BatchChildOutcome } from "../batch-audit"
import type { MaintenanceJobResult } from "../registry"

// Pure unit coverage for the batch rollup builder (#508). No DB — only the
// child-outcomes → parent-batch-row aggregation.
describe("ops/maintenance-jobs buildBatchRollup (#508)", () => {
  const meta = {
    name: "tenant cleanup",
    actorId: "user_abc",
    dryRun: true,
    stopOnError: false,
  }

  const ok = (
    job_id: string,
    overrides: Partial<MaintenanceJobResult> = {}
  ): BatchChildOutcome => ({
    job_id,
    ok: true,
    result: {
      job_id,
      dry_run: true,
      applied: false,
      summary: `${job_id} preview`,
      changes: [],
      ...overrides,
    },
  })

  it("rolls up a clean 2-job dry-run preview", () => {
    const outcomes: BatchChildOutcome[] = [
      ok("repair-partner-region-links", {
        changes: [
          { entity: "partner_region", id: "p1", field: "region_id", before: null, after: "reg_1" },
        ],
      }),
      ok("resync-product-partner-landing-url", {
        changes: [
          { entity: "product", id: "prod_1", field: "link", before: "a", after: "b" },
          { entity: "product", id: "prod_2", field: "link", before: "c", after: "d" },
        ],
      }),
    ]

    const row = buildBatchRollup(outcomes, meta)

    expect(row).toEqual({
      name: "tenant cleanup",
      actor_id: "user_abc",
      dry_run: true,
      stop_on_error: false,
      job_count: 2,
      applied_count: 0,
      failed_count: 0,
      change_count: 3,
      error_count: 0,
      summary: "Previewed 2 job(s): 3 change(s), 0 applied, 0 failed, 0 error(s)",
    })
  })

  it("counts applied children and per-entity errors on an apply run", () => {
    const outcomes: BatchChildOutcome[] = [
      ok("job-a", {
        dry_run: false,
        applied: true,
        changes: [{ entity: "x", id: "1", field: "f", before: 0, after: 1 }],
      }),
      ok("job-b", {
        dry_run: false,
        applied: true,
        changes: [{ entity: "y", id: "2", field: "g", before: 2, after: 3 }],
        errors: [{ id: "bad_1", message: "not found" }],
      }),
      // No-op apply: ran fine but wrote nothing.
      ok("job-c", { dry_run: false, applied: false }),
    ]

    const row = buildBatchRollup(outcomes, {
      ...meta,
      dryRun: false,
    })

    expect(row.dry_run).toBe(false)
    expect(row.job_count).toBe(3)
    expect(row.applied_count).toBe(2)
    expect(row.failed_count).toBe(0)
    expect(row.change_count).toBe(2)
    expect(row.error_count).toBe(1)
    expect(row.summary).toBe(
      "Applied 3 job(s): 2 change(s), 2 applied, 0 failed, 1 error(s)"
    )
  })

  it("counts a thrown child as failed, not as a per-entity error", () => {
    const outcomes: BatchChildOutcome[] = [
      ok("job-ok", {
        changes: [{ entity: "x", id: "1", field: "f", before: 0, after: 1 }],
      }),
      { job_id: "job-throws", ok: false, error: "Region not found: reg_x" },
    ]

    const row = buildBatchRollup(outcomes, meta)

    expect(row.job_count).toBe(2)
    expect(row.failed_count).toBe(1)
    expect(row.error_count).toBe(0)
    expect(row.change_count).toBe(1)
    expect(row.applied_count).toBe(0)
    expect(row.summary).toBe(
      "Previewed 2 job(s): 1 change(s), 0 applied, 1 failed, 0 error(s)"
    )
  })

  it("handles an empty/zero-outcome batch", () => {
    const row = buildBatchRollup([], meta)
    expect(row.job_count).toBe(0)
    expect(row.applied_count).toBe(0)
    expect(row.failed_count).toBe(0)
    expect(row.change_count).toBe(0)
    expect(row.error_count).toBe(0)
  })
})

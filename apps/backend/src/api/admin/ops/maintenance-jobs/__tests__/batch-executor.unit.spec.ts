import { runBatch } from "../batch-executor"
import type { BatchJobSpec, RunSingleJob } from "../batch-executor"
import { buildBatchChildRow } from "../batch-audit"
import type { BatchChildOutcome } from "../batch-audit"
import type { MaintenanceJobResult } from "../registry"

// Pure unit coverage for the #508 batch sequential executor + child-row mapper.
// The executor's job is the one behaviour that MUST hold: a child that THROWS is
// caught and recorded, and (by default) the rest of the batch still runs. We
// inject a fake `runJob` so no container/registry/DB is needed.

const result = (
  job_id: string,
  overrides: Partial<MaintenanceJobResult> = {}
): MaintenanceJobResult => ({
  job_id,
  dry_run: true,
  applied: false,
  summary: `${job_id} preview`,
  changes: [],
  ...overrides,
})

describe("ops/maintenance-jobs runBatch (#508)", () => {
  const jobs: BatchJobSpec[] = [
    { job_id: "job-a", params: {} },
    { job_id: "job-b", params: { x: 1 } },
    { job_id: "job-c", params: {} },
  ]

  it("runs every job sequentially and returns ok outcomes in order", async () => {
    const seen: string[] = []
    const runJob: RunSingleJob = async (_c, jobId, opts) => {
      seen.push(jobId)
      expect(opts.dry_run).toBe(true)
      return result(jobId)
    }

    const outcomes = await runBatch({} as any, {
      jobs,
      dry_run: true,
      stop_on_error: false,
      runJob,
    })

    expect(seen).toEqual(["job-a", "job-b", "job-c"])
    expect(outcomes).toHaveLength(3)
    expect(outcomes.every((o) => o.ok)).toBe(true)
    expect(outcomes.map((o) => o.job_id)).toEqual(["job-a", "job-b", "job-c"])
  })

  it("passes the batch-level dry_run + per-job params through to each job", async () => {
    const calls: Array<{ jobId: string; opts: any }> = []
    const runJob: RunSingleJob = async (_c, jobId, opts) => {
      calls.push({ jobId, opts })
      return result(jobId, { dry_run: false })
    }

    await runBatch({} as any, {
      jobs,
      dry_run: false,
      stop_on_error: false,
      runJob,
    })

    expect(calls[1]).toEqual({
      jobId: "job-b",
      opts: { dry_run: false, params: { x: 1 } },
    })
    expect(calls.every((c) => c.opts.dry_run === false)).toBe(true)
  })

  it("CATCHES a thrown child and continues the batch (continue-on-error default)", async () => {
    const runJob: RunSingleJob = async (_c, jobId) => {
      if (jobId === "job-b") {
        throw new Error("Region not found: reg_x")
      }
      return result(jobId)
    }

    const outcomes = await runBatch({} as any, {
      jobs,
      dry_run: true,
      stop_on_error: false,
      runJob,
    })

    // All three attempted — the throw did NOT abort the request.
    expect(outcomes).toHaveLength(3)
    expect(outcomes[0]).toMatchObject({ job_id: "job-a", ok: true })
    expect(outcomes[1]).toEqual({
      job_id: "job-b",
      ok: false,
      error: "Region not found: reg_x",
    })
    expect(outcomes[2]).toMatchObject({ job_id: "job-c", ok: true })
  })

  it("halts after the first failure when stop_on_error=true", async () => {
    const seen: string[] = []
    const runJob: RunSingleJob = async (_c, jobId) => {
      seen.push(jobId)
      if (jobId === "job-b") {
        throw new Error("boom")
      }
      return result(jobId)
    }

    const outcomes = await runBatch({} as any, {
      jobs,
      dry_run: true,
      stop_on_error: true,
      runJob,
    })

    // job-c never ran — the loop broke after job-b failed.
    expect(seen).toEqual(["job-a", "job-b"])
    expect(outcomes).toHaveLength(2)
    expect(outcomes[1]).toEqual({ job_id: "job-b", ok: false, error: "boom" })
  })

  it("handles an empty job list as a zero-outcome batch", async () => {
    const outcomes = await runBatch({} as any, {
      jobs: [],
      dry_run: true,
      stop_on_error: false,
      runJob: async () => result("never"),
    })
    expect(outcomes).toEqual([])
  })
})

describe("ops/maintenance-jobs buildBatchChildRow (#508)", () => {
  it("maps a successful child to a batch-stamped audit row", () => {
    const outcome: BatchChildOutcome = {
      job_id: "repair-partner-region-links",
      ok: true,
      result: result("repair-partner-region-links", {
        dry_run: false,
        applied: true,
        changes: [
          { entity: "partner_region", id: "p1", field: "region_id", before: null, after: "reg_1" },
        ],
        errors: [{ id: "bad", message: "skip" }],
      }),
    }

    const row = buildBatchChildRow(outcome, {
      actorId: "user_1",
      params: { partner_id: "p1" },
      dryRun: false,
      batchId: "batch_1",
      jobIndex: 0,
    })

    expect(row).toMatchObject({
      job_id: "repair-partner-region-links",
      actor_id: "user_1",
      dry_run: false,
      applied: true,
      change_count: 1,
      error_count: 1,
      params: { partner_id: "p1" },
      batch_id: "batch_1",
      job_index: 0,
    })
    expect(row.changes).toHaveLength(1)
  })

  it("maps a thrown child to a not-applied, error-carrying row using the batch dry_run", () => {
    const outcome: BatchChildOutcome = {
      job_id: "job-throws",
      ok: false,
      error: "Region not found: reg_x",
    }

    const row = buildBatchChildRow(outcome, {
      actorId: "user_1",
      params: { region_id: "reg_x" },
      dryRun: true,
      batchId: "batch_2",
      jobIndex: 3,
    })

    expect(row).toEqual({
      job_id: "job-throws",
      actor_id: "user_1",
      dry_run: true,
      applied: false,
      change_count: 0,
      error_count: 1,
      summary: "Job failed: Region not found: reg_x",
      params: { region_id: "reg_x" },
      changes: [],
      errors: [{ id: "job-throws", message: "Region not found: reg_x" }],
      batch_id: "batch_2",
      job_index: 3,
    })
  })
})

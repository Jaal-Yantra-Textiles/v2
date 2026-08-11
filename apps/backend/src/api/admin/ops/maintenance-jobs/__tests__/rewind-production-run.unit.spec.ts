import {
  fieldsToClearForRewind,
  planRunRewind,
  rewindProductionRunJob,
} from "../rewind-production-run-job"
import { getMaintenanceJob, MAINTENANCE_JOBS } from "../registry"

/**
 * #1228/#1248 — rewinding a run that was completed without its data.
 *
 * The prod case: prod_run_01KWPVZ4R2PWK6DW1X8X5DKNZE ran accept → start →
 * finish → complete in 36 seconds with `produced_quantity` null, no consumption
 * logged, and its two dispatch tasks left at `accepted`. Nothing in the
 * platform could put it back.
 */

const completedRun = (over: Record<string, any> = {}) => ({
  id: "prod_run_1",
  status: "completed",
  parent_run_id: null,
  partner_id: "partner_1",
  accepted_at: "2026-08-11T09:06:42.621Z",
  started_at: "2026-08-11T09:06:47.997Z",
  finished_at: "2026-08-11T09:06:53.893Z",
  completed_at: "2026-08-11T09:06:59.193Z",
  produced_quantity: null,
  rejected_quantity: null,
  rejection_reason: null,
  rejection_notes: null,
  completion_notes: null,
  finish_notes: null,
  dispatch_state: "completed",
  dispatch_started_at: "2026-08-11T09:06:23.074Z",
  dispatch_completed_at: "2026-08-11T09:06:24.218Z",
  cancelled_at: null,
  deleted_at: null,
  ...over,
})

describe("fieldsToClearForRewind", () => {
  it("keeps accepted_at/started_at when rewinding to in_progress", () => {
    const fields = fieldsToClearForRewind("in_progress")
    expect(fields).toContain("completed_at")
    expect(fields).toContain("finished_at")
    expect(fields).toContain("produced_quantity")
    expect(fields).not.toContain("accepted_at")
    expect(fields).not.toContain("started_at")
  })

  it("clears the acceptance stamps when rewinding behind acceptance", () => {
    const fields = fieldsToClearForRewind("sent_to_partner")
    expect(fields).toContain("accepted_at")
    expect(fields).toContain("started_at")
    // Still sent — the dispatch itself stands.
    expect(fields).not.toContain("dispatch_state")
  })

  it("rewinds the dispatch cycle only when going back to approved", () => {
    const fields = fieldsToClearForRewind("approved")
    expect(fields).toContain("dispatch_state")
    expect(fields).toContain("dispatch_started_at")
    expect(fields).toContain("dispatch_completed_at")
  })
})

describe("planRunRewind", () => {
  const byField = (changes: any[], field: string) =>
    changes.find((c) => c.field === field)

  it("moves the status and clears the completion stamps", () => {
    const changes = planRunRewind(completedRun(), "in_progress")

    expect(byField(changes, "status")).toMatchObject({
      before: "completed",
      after: "in_progress",
    })
    expect(byField(changes, "completed_at")).toMatchObject({
      before: "2026-08-11T09:06:59.193Z",
      after: null,
    })
    expect(byField(changes, "finished_at")?.after).toBeNull()
  })

  it("does not emit a change for a field already at its rewound value", () => {
    // produced_quantity is ALREADY null on the prod run — the defect, not a diff.
    const changes = planRunRewind(completedRun(), "in_progress")
    expect(byField(changes, "produced_quantity")).toBeUndefined()
  })

  it("clears a produced_quantity that was recorded", () => {
    const changes = planRunRewind(
      completedRun({ produced_quantity: 3 }),
      "in_progress"
    )
    expect(byField(changes, "produced_quantity")).toMatchObject({
      before: 3,
      after: null,
    })
  })

  it("rewinds dispatch_state to 'idle', never null (non-nullable enum)", () => {
    const changes = planRunRewind(completedRun(), "approved")
    expect(byField(changes, "dispatch_state")).toMatchObject({
      before: "completed",
      after: "idle",
    })
  })

  it("emits nothing when the run already sits at the target", () => {
    const alreadyThere = completedRun({
      status: "in_progress",
      finished_at: null,
      completed_at: null,
      rejection_reason: null,
      rejection_notes: null,
      completion_notes: null,
      finish_notes: null,
    })
    expect(planRunRewind(alreadyThere, "in_progress")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// run() — the container-bound half
// ---------------------------------------------------------------------------

const makeContainer = (opts: {
  run: Record<string, any>
  parent?: Record<string, any>
  logs?: any[]
  tasks?: any[]
}) => {
  const updateProductionRuns = jest.fn().mockResolvedValue(undefined)
  const updateTasks = jest.fn().mockResolvedValue(undefined)
  const createProductionRunActivities = jest.fn().mockResolvedValue(undefined)

  const runs: Record<string, any> = { [opts.run.id]: opts.run }
  if (opts.parent) {
    runs[opts.parent.id] = opts.parent
  }

  const container = {
    resolve: (key: string) => {
      if (key === "query") {
        return {
          graph: jest.fn().mockResolvedValue({
            data: [{ id: opts.run.id, tasks: opts.tasks ?? [] }],
          }),
        }
      }
      if (key === "production_runs") {
        return {
          retrieveProductionRun: jest.fn(async (id: string) => {
            if (!runs[id]) throw new Error("not found")
            return runs[id]
          }),
          updateProductionRuns,
          createProductionRunActivities,
        }
      }
      if (key === "consumption_log") {
        const logs = opts.logs ?? []
        return {
          listAndCountConsumptionLogs: jest
            .fn()
            .mockResolvedValue([logs, logs.length]),
        }
      }
      return { updateTasks }
    },
  } as any

  return { container, updateProductionRuns, updateTasks, createProductionRunActivities }
}

describe("rewind-production-run — run()", () => {
  it("previews without writing on a dry run", async () => {
    const { container, updateProductionRuns, updateTasks } = makeContainer({
      run: completedRun(),
      tasks: [{ id: "task_1", status: "completed", title: "Sampling" }],
    })

    const result = await rewindProductionRunJob.run(container, {
      dry_run: true,
      params: { production_run_id: "prod_run_1" },
    } as any)

    expect(result.applied).toBe(false)
    expect(result.changes.length).toBeGreaterThan(0)
    expect(updateProductionRuns).not.toHaveBeenCalled()
    expect(updateTasks).not.toHaveBeenCalled()
    expect(result.summary).toMatch(/Would rewind/)
  })

  it("writes the run, reopens closed tasks and records the timeline entry", async () => {
    const {
      container,
      updateProductionRuns,
      updateTasks,
      createProductionRunActivities,
    } = makeContainer({
      run: completedRun(),
      tasks: [
        { id: "task_1", status: "completed", title: "production-run-x" },
        { id: "task_2", status: "cancelled", title: "Stitching" },
        { id: "task_3", status: "accepted", title: "Sampling" },
      ],
    })

    const result = await rewindProductionRunJob.run(container, {
      dry_run: false,
      params: { production_run_id: "prod_run_1" },
    } as any)

    expect(result.applied).toBe(true)
    expect(updateProductionRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "prod_run_1",
        status: "in_progress",
        completed_at: null,
        finished_at: null,
      })
    )
    // Only the CLOSED ones reopen — an already-open task is left alone.
    expect(updateTasks).toHaveBeenCalledTimes(2)
    expect(updateTasks).toHaveBeenCalledWith({ id: "task_1", status: "in_progress" })
    expect(updateTasks).toHaveBeenCalledWith({ id: "task_2", status: "in_progress" })
    expect(createProductionRunActivities).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "rewound" })
    )
  })

  it("refuses when consumption logs would be duplicated by re-completion", async () => {
    const { container } = makeContainer({
      run: completedRun(),
      logs: [{ id: "log_1" }, { id: "log_2" }],
    })

    await expect(
      rewindProductionRunJob.run(container, {
        dry_run: true,
        params: { production_run_id: "prod_run_1" },
      } as any)
    ).rejects.toThrow(/2 consumption log/)
  })

  it("proceeds on the same run when forced, and says so", async () => {
    const { container } = makeContainer({
      run: completedRun(),
      logs: [{ id: "log_1" }],
    })

    const result = await rewindProductionRunJob.run(container, {
      dry_run: true,
      params: { production_run_id: "prod_run_1", force: true },
    } as any)

    expect(result.summary).toMatch(/1 consumption log\(s\) already attached/)
  })

  it("refuses to rewind a cancelled run — that would resurrect it", async () => {
    const { container } = makeContainer({
      run: completedRun({ status: "cancelled", cancelled_at: "2026-08-01" }),
    })

    await expect(
      rewindProductionRunJob.run(container, {
        dry_run: true,
        params: { production_run_id: "prod_run_1" },
      } as any)
    ).rejects.toThrow(/cancelled/)
  })

  it("leaves the parent alone unless asked, and says the parent was skipped", async () => {
    const { container, updateProductionRuns } = makeContainer({
      run: completedRun({ parent_run_id: "prod_run_parent" }),
      parent: completedRun({ id: "prod_run_parent" }),
    })

    const result = await rewindProductionRunJob.run(container, {
      dry_run: false,
      params: { production_run_id: "prod_run_1" },
    } as any)

    expect(result.summary).toMatch(/parent prod_run_parent left as-is/)
    expect(updateProductionRuns).toHaveBeenCalledTimes(1)
  })

  it("rewinds the parent too when asked", async () => {
    const { container, updateProductionRuns } = makeContainer({
      run: completedRun({ parent_run_id: "prod_run_parent" }),
      parent: completedRun({ id: "prod_run_parent" }),
    })

    const result = await rewindProductionRunJob.run(container, {
      dry_run: false,
      params: { production_run_id: "prod_run_1", rewind_parent: true },
    } as any)

    expect(updateProductionRuns).toHaveBeenCalledTimes(2)
    expect(updateProductionRuns).toHaveBeenCalledWith(
      expect.objectContaining({ id: "prod_run_parent", status: "in_progress" })
    )
    expect(result.summary).toMatch(/and parent prod_run_parent/)
  })

  it("always warns that stocked finished goods are not reversed", async () => {
    const { container } = makeContainer({ run: completedRun() })

    const result = await rewindProductionRunJob.run(container, {
      dry_run: true,
      params: { production_run_id: "prod_run_1" },
    } as any)

    expect(result.summary).toMatch(/finished goods .* NOT reversed/)
  })

  it("404s on an unknown run", async () => {
    const { container } = makeContainer({ run: completedRun() })

    await expect(
      rewindProductionRunJob.run(container, {
        dry_run: true,
        params: { production_run_id: "prod_run_nope" },
      } as any)
    ).rejects.toThrow(/not found/)
  })

  it("rejects an unknown to_status rather than silently defaulting", async () => {
    const { container } = makeContainer({ run: completedRun() })

    await expect(
      rewindProductionRunJob.run(container, {
        dry_run: true,
        params: { production_run_id: "prod_run_1", to_status: "banana" },
      } as any)
    ).rejects.toThrow(/to_status/)
  })
})

describe("rewind-production-run — registry wiring", () => {
  it("is registered and resolvable by id", () => {
    expect(getMaintenanceJob("rewind-production-run")).toBe(rewindProductionRunJob)
    expect(MAINTENANCE_JOBS).toContain(rewindProductionRunJob)
  })

  it("declares production_run_id as its only required param", () => {
    const required = rewindProductionRunJob.params
      .filter((p) => p.required)
      .map((p) => p.name)
    expect(required).toEqual(["production_run_id"])
  })
})

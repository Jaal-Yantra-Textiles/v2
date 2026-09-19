import { describe, expect, it } from "vitest"

import { deriveTaskRow, summarizeTaskRows } from "../task-row"

describe("deriveTaskRow", () => {
  it.each(["pending", "assigned"])(
    "offers accept from %s",
    (status) => {
      expect(deriveTaskRow({ id: "t", status }).action).toBe("accept")
    }
  )

  it.each(["accepted", "in_progress"])(
    "offers finish from %s",
    (status) => {
      expect(deriveTaskRow({ id: "t", status }).action).toBe("finish")
    }
  )

  it("offers nothing on a completed task", () => {
    const row = deriveTaskRow({ id: "t", status: "completed" })
    expect(row.action).toBeNull()
    expect(row.isCompleted).toBe(true)
  })

  it("offers nothing on a status it does not recognise", () => {
    expect(deriveTaskRow({ id: "t", status: "cancelled" }).action).toBeNull()
  })

  it("defaults a missing status to pending rather than to nothing", () => {
    expect(deriveTaskRow({ id: "t" }).status).toBe("pending")
    expect(deriveTaskRow({ id: "t" }).action).toBe("accept")
  })

  it("counts completed subtasks against the total", () => {
    const row = deriveTaskRow({
      id: "t",
      subtasks: [
        { status: "completed" },
        { status: "completed" },
        { status: "pending" },
      ],
    })
    expect(row.subtasksDone).toBe(2)
    expect(row.subtasksTotal).toBe(3)
  })

  /**
   * 🔴 An estimated cost of 0 is a COSTED task — the finish flow still asks
   * for an actual. `Number(null)` is 0, so a truthiness check gets this
   * backwards in both directions.
   */
  it("treats an estimated cost of 0 as costed, and a missing one as not", () => {
    expect(deriveTaskRow({ id: "t", estimated_cost: 0 }).needsCost).toBe(true)
    expect(deriveTaskRow({ id: "t", estimated_cost: null }).needsCost).toBe(false)
    expect(deriveTaskRow({ id: "t" }).needsCost).toBe(false)
  })

  it("survives a null task", () => {
    expect(deriveTaskRow(null).id).toBe("")
    expect(deriveTaskRow(undefined).subtasksTotal).toBe(0)
  })
})

describe("summarizeTaskRows", () => {
  it("counts total, completed and actionable", () => {
    expect(
      summarizeTaskRows([
        { status: "completed" },
        { status: "in_progress" },
        { status: "pending" },
        { status: "cancelled" },
      ])
    ).toEqual({ total: 4, completed: 1, actionable: 2 })
  })

  it("is zero for no tasks", () => {
    expect(summarizeTaskRows([])).toEqual({
      total: 0,
      completed: 0,
      actionable: 0,
    })
    expect(summarizeTaskRows(null).total).toBe(0)
  })
})

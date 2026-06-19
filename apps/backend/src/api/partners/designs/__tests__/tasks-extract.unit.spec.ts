import {
  extractDesignTasks,
  DesignTasksRow,
} from "../[designId]/tasks/extract-tasks"

describe("extractDesignTasks (#337 partner design tasks)", () => {
  it("returns the design's tasks array", () => {
    const rows: DesignTasksRow[] = [
      { id: "d1", tasks: [{ id: "t1" }, { id: "t2" }] },
    ]
    expect(extractDesignTasks(rows)).toEqual([{ id: "t1" }, { id: "t2" }])
  })

  it("returns [] when the design has no tasks", () => {
    expect(extractDesignTasks([{ id: "d1", tasks: [] }])).toEqual([])
  })

  it("returns [] when tasks is null/undefined (unresolved relation)", () => {
    expect(extractDesignTasks([{ id: "d1", tasks: null }])).toEqual([])
    expect(extractDesignTasks([{ id: "d1" }])).toEqual([])
  })

  it("returns [] when query.graph yielded no design row (no crash)", () => {
    // Admin reads tasks[0].tasks directly → throws here; helper must not.
    expect(extractDesignTasks([])).toEqual([])
  })

  it("is null/undefined-input safe", () => {
    expect(extractDesignTasks(null)).toEqual([])
    expect(extractDesignTasks(undefined)).toEqual([])
  })

  it("ignores a non-array tasks value defensively", () => {
    expect(
      extractDesignTasks([{ id: "d1", tasks: "oops" as any }])
    ).toEqual([])
  })
})

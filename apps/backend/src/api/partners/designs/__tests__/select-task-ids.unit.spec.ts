import { selectCreatedTaskIds } from "../[designId]/tasks/select-task-ids"

describe("selectCreatedTaskIds (#337 partner design tasks POST)", () => {
  it("returns all task ids when withTemplates is set", () => {
    const ids = selectCreatedTaskIds({ withTemplates: true }, [
      { id: "t1" },
      { id: "t2" },
      { id: "t3" },
    ])
    expect(ids).toEqual(["t1", "t2", "t3"])
  })

  it("returns all task ids when withParent is set", () => {
    const ids = selectCreatedTaskIds({ withParent: true }, [
      { id: "p1" },
      { id: "c1" },
    ])
    expect(ids).toEqual(["p1", "c1"])
  })

  it("returns only the first task id when withoutTemplates is set", () => {
    const ids = selectCreatedTaskIds({ withoutTemplates: true }, [
      { id: "single" },
      { id: "ignored" },
    ])
    expect(ids).toEqual(["single"])
  })

  it("returns [] when no flag matches", () => {
    expect(selectCreatedTaskIds({}, [{ id: "t1" }])).toEqual([])
    expect(selectCreatedTaskIds(null, [{ id: "t1" }])).toEqual([])
    expect(selectCreatedTaskIds(undefined, [{ id: "t1" }])).toEqual([])
  })

  it("never throws on empty/missing taskLinks (admin route would crash here)", () => {
    expect(selectCreatedTaskIds({ withoutTemplates: true }, [])).toEqual([])
    expect(selectCreatedTaskIds({ withTemplates: true }, null)).toEqual([])
    expect(selectCreatedTaskIds({ withParent: true }, undefined)).toEqual([])
  })

  it("filters out null/empty ids defensively", () => {
    const ids = selectCreatedTaskIds({ withTemplates: true }, [
      { id: "t1" },
      { id: null },
      { id: "" },
      { id: "t2" },
    ])
    expect(ids).toEqual(["t1", "t2"])
  })
})

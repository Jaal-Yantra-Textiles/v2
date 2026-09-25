import { describe, expect, it } from "vitest"

import {
  comboKey,
  initialSplit,
  needsSplit,
  planSplit,
  splitAxes,
  splitCombos,
} from "../completion-split"

/** #2271 — the Luong Shirt run on prod: sizes S and M, 3 pieces, no plan. */
const LUONG = { snapshot: { size_sets: [{ size_label: "S" }, { size_label: "M" }], colors: [] } }

describe("completion split (#2271)", () => {
  it("asks only when the run is for several sizes or colours", () => {
    expect(needsSplit(splitAxes(LUONG))).toBe(true)
    expect(needsSplit(splitAxes({ snapshot: { size_sets: [{ size_label: "M" }] } }))).toBe(false)
    expect(needsSplit(splitAxes({}))).toBe(false)
    expect(planSplit(splitAxes({}), {}, 3)).toEqual({ needed: false })
  })

  it("offers every size × colour combination", () => {
    const axes = splitAxes({
      snapshot: {
        size_sets: [{ size_label: "S" }, { size_label: "M" }],
        colors: [{ name: "Indigo" }, { name: "Rust" }],
      },
    })
    expect(splitCombos(axes)).toHaveLength(4)
  })

  it("sends only the made combinations, and says when they add up", () => {
    const axes = splitAxes(LUONG)
    const plan = planSplit(axes, { [comboKey("S", null)]: "1", [comboKey("M", null)]: "2" }, 3)
    expect(plan).toEqual({
      needed: true,
      ok: true,
      total: 3,
      target: 3,
      lines: [
        { size_label: "S", color: null, quantity: 1 },
        { size_label: "M", color: null, quantity: 2 },
      ],
    })
    expect(planSplit(axes, { [comboKey("M", null)]: "2" }, 3)).toMatchObject({ ok: false })
  })

  it("pre-fills from the plan only when it adds up to what goes to stock", () => {
    const run = {
      ...LUONG,
      planned_output: [
        { size_label: "S", quantity: 1 },
        { size_label: "M", quantity: 2 },
      ],
    }
    const axes = splitAxes(run)
    expect(initialSplit(run, axes, 3)[comboKey("M", null)]).toBe("2")
    expect(initialSplit(run, axes, 2)[comboKey("M", null)]).toBe("")
  })

  it("starts blank with no plan — never guesses a size", () => {
    const axes = splitAxes(LUONG)
    const values = initialSplit(LUONG, axes, 3)
    expect(Object.values(values).every((v) => v === "")).toBe(true)
    expect(planSplit(axes, values, 3)).toMatchObject({ ok: false, total: 0 })
  })
})

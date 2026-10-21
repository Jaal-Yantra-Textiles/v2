import { describe, expect, it } from "vitest"
import {
  COMPLETION_STEPS,
  completionStepNav,
  showCompletionSection,
} from "../completion-steps"

describe("completion steps (#2440)", () => {
  it("puts materials in a step of their own, between output and cost", () => {
    expect(COMPLETION_STEPS.map((s) => s.key)).toEqual(["output", "materials", "cost"])
  })

  it("clamps Back and Next to the step list", () => {
    expect(completionStepNav(0)).toMatchObject({ isFirst: true, isLast: false, prev: 0, next: 1 })
    expect(completionStepNav(2)).toMatchObject({ isFirst: false, isLast: true, prev: 1, next: 2 })
    expect(completionStepNav(9).index).toBe(2)
    expect(completionStepNav(-1).index).toBe(0)
  })

  it("shows only the current step's section on a phone", () => {
    expect(showCompletionSection("materials", true, 1)).toBe(true)
    expect(showCompletionSection("output", true, 1)).toBe(false)
    expect(showCompletionSection("cost", true, 1)).toBe(false)
  })

  it("shows every section on desktop", () => {
    for (const s of COMPLETION_STEPS) {
      expect(showCompletionSection(s.key, false, 0)).toBe(true)
    }
  })
})

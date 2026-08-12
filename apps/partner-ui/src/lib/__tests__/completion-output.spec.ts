import { describe, expect, it } from "vitest"

import { planCompletionOutput } from "../completion-output"

describe("planCompletionOutput (#1271)", () => {
  it("passes a completion that accounts for everything ordered", () => {
    const plan = planCompletionOutput({ ordered: 10, produced: 10, rejected: 0 })

    expect(plan.unaccounted).toBe(0)
    expect(plan.allowShortfall).toBe(false)
    expect(plan.needsReason).toBe(false)
    expect(plan.noteLine).toBeNull()
  })

  it("counts rejects as accounted output, not as a shortfall", () => {
    // 9 good + 1 rejected against an order of 10 is a complete, honest
    // completion — the gate asks what happened to the units, not that they
    // all succeeded.
    const plan = planCompletionOutput({ ordered: 10, produced: 9, rejected: 1 })

    expect(plan.unaccounted).toBe(0)
    expect(plan.allowShortfall).toBe(false)
  })

  it("asks for a reason when units are unaccounted for", () => {
    const plan = planCompletionOutput({ ordered: 10, produced: 8, rejected: 0 })

    expect(plan.unaccounted).toBe(2)
    expect(plan.needsReason).toBe(true)
    // Nothing is sent until the partner says what happened — the alternative
    // the old form pushed them towards was inflating produced to 10.
    expect(plan.noteLine).toBeNull()
  })

  it("declares the shortfall once a reason is given", () => {
    const plan = planCompletionOutput({
      ordered: 10,
      produced: 8,
      rejected: 0,
      shortfallReason: "  fabric ran out after 8  ",
    })

    expect(plan.unaccounted).toBe(2)
    expect(plan.allowShortfall).toBe(true)
    expect(plan.needsReason).toBe(false)
    expect(plan.noteLine).toBe(
      "Shortfall: 2 of 10 not produced — fabric ran out after 8"
    )
  })

  it("treats whitespace as no reason at all", () => {
    const plan = planCompletionOutput({
      ordered: 10,
      produced: 8,
      rejected: 0,
      shortfallReason: "   ",
    })

    expect(plan.needsReason).toBe(true)
    expect(plan.noteLine).toBeNull()
  })

  it("splits the remainder between rejects and shortfall", () => {
    const plan = planCompletionOutput({
      ordered: 10,
      produced: 6,
      rejected: 2,
      shortfallReason: "two were never cut",
    })

    expect(plan.unaccounted).toBe(2)
    expect(plan.noteLine).toBe(
      "Shortfall: 2 of 10 not produced — two were never cut"
    )
  })

  it("never reports a negative shortfall when output exceeds the order", () => {
    const plan = planCompletionOutput({ ordered: 10, produced: 12, rejected: 0 })

    expect(plan.unaccounted).toBe(0)
    expect(plan.allowShortfall).toBe(false)
  })

  it("enforces nothing when there is no ordered quantity", () => {
    // Runs created without one predate the field being meaningful; the
    // backend gate skips them too.
    const plan = planCompletionOutput({ ordered: 0, produced: 0, rejected: 0 })

    expect(plan.unaccounted).toBe(0)
    expect(plan.needsReason).toBe(false)
  })
})

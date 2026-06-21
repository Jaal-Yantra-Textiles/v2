import { findMatchingCustomGoal } from "../match-custom-goal"

describe("findMatchingCustomGoal (#568)", () => {
  const goals = [
    { id: "g1", conditions: { event_name: "Checkout_Complete" } },
    { id: "g2", conditions: { event_name: "newsletter_signup" } },
    { id: "g3", conditions: {} },
    { id: "g4", conditions: null },
  ]

  it("matches on conditions.event_name (case-insensitive)", () => {
    expect(findMatchingCustomGoal(goals, "checkout_complete")?.id).toBe("g1")
    expect(findMatchingCustomGoal(goals, "CHECKOUT_COMPLETE")?.id).toBe("g1")
    expect(findMatchingCustomGoal(goals, "newsletter_signup")?.id).toBe("g2")
  })

  it("returns undefined when no goal matches", () => {
    expect(findMatchingCustomGoal(goals, "unknown_event")).toBeUndefined()
  })

  it("returns undefined for empty / nullish event names", () => {
    expect(findMatchingCustomGoal(goals, "")).toBeUndefined()
    expect(findMatchingCustomGoal(goals, "   ")).toBeUndefined()
    expect(findMatchingCustomGoal(goals, undefined)).toBeUndefined()
    expect(findMatchingCustomGoal(goals, null)).toBeUndefined()
  })

  it("ignores goals without a conditions.event_name", () => {
    expect(findMatchingCustomGoal([{ id: "x", conditions: {} }], "anything")).toBeUndefined()
    expect(findMatchingCustomGoal([{ id: "y", conditions: null }], "anything")).toBeUndefined()
  })

  it("does NOT read a legacy trigger_event_name field (the #568 bug)", () => {
    // Goals that only had the (non-existent) trigger_event_name must never match.
    const legacy = [{ id: "z", trigger_event_name: "purchase", conditions: {} }]
    expect(findMatchingCustomGoal(legacy as any, "purchase")).toBeUndefined()
  })
})

import { describe, expect, it } from "vitest"

import {
  deriveRunPhase,
  deriveRunStepIndex,
  getRunNextAction,
  isPhaseAtLeast,
} from "./run-phase"

/**
 * #2018 — the phase logic decides both the pinned action and what the page
 * reveals, so it is the one part of this rework that must be provably right.
 * These cases are the run shapes the partner surface actually produces.
 */
describe("deriveRunStepIndex", () => {
  it("reads timestamps before status", () => {
    // 🔴 The case the stepper's own comment warns about: the task-completion
    // subscriber can move `status` without writing lifecycle timestamps. A
    // status-first read would report this run as finished.
    expect(
      deriveRunStepIndex({ status: "in_progress", started_at: null })
    ).toBe(2)
    expect(
      deriveRunStepIndex({ status: "in_progress", started_at: "2026-01-01", finished_at: "2026-01-02" })
    ).toBe(3)
  })

  it("treats a cancelled run as off the ladder entirely", () => {
    expect(deriveRunStepIndex({ status: "cancelled" })).toBe(-1)
    // Even one that got as far as finishing.
    expect(
      deriveRunStepIndex({ status: "cancelled", finished_at: "2026-01-02" })
    ).toBe(-1)
  })

  it("counts completion from either the timestamp or the status", () => {
    expect(deriveRunStepIndex({ status: "in_progress", completed_at: "2026-01-03" })).toBe(4)
    expect(deriveRunStepIndex({ status: "completed" })).toBe(4)
  })

  it("is 0 for a run just sent to the partner", () => {
    expect(deriveRunStepIndex({ status: "sent_to_partner" })).toBe(0)
  })
})

describe("deriveRunPhase", () => {
  it("maps each step to the phase that gates the page", () => {
    expect(deriveRunPhase({ status: "sent_to_partner" })).toBe("offered")
    expect(deriveRunPhase({ status: "sent_to_partner", accepted_at: "x" })).toBe("accepted")
    expect(deriveRunPhase({ status: "in_progress", started_at: "x" })).toBe("in_production")
    expect(deriveRunPhase({ status: "in_progress", finished_at: "x" })).toBe("in_production")
    expect(deriveRunPhase({ status: "completed" })).toBe("done")
    expect(deriveRunPhase({ status: "cancelled" })).toBe("cancelled")
  })
})

describe("getRunNextAction", () => {
  it("mirrors the card's can* guards, which key on status", () => {
    expect(getRunNextAction({ status: "sent_to_partner" })?.key).toBe("accept")
    expect(getRunNextAction({ status: "in_progress" })?.key).toBe("start")
    expect(getRunNextAction({ status: "in_progress", started_at: "x" })?.key).toBe("finish")
    expect(
      getRunNextAction({ status: "in_progress", started_at: "x", finished_at: "y" })?.key
    ).toBe("complete")
  })

  it("does NOT offer start just because the run was accepted", () => {
    /**
     * 🔴 The divergence this function exists to avoid. `accepted_at` set with
     * status still `sent_to_partner` is PHASE "accepted", but `canStart`
     * requires `in_progress`. Deriving the button from the phase would offer
     * Start for a run the API refuses.
     */
    const run = { status: "sent_to_partner", accepted_at: "x" }
    expect(deriveRunPhase(run)).toBe("accepted")
    expect(getRunNextAction(run)?.key).toBe("accept")
  })

  it("offers NOTHING once the run is settled", () => {
    // A finished job presenting a button is how work gets done twice, and a
    // cancelled run presenting one is the same mistake as a canceled order
    // advertising `assigned` (#2030).
    expect(getRunNextAction({ status: "completed" })).toBeNull()
    expect(getRunNextAction({ status: "cancelled" })).toBeNull()
    expect(getRunNextAction({ status: "cancelled", started_at: "x" })).toBeNull()
  })

  it("offers nothing when the assignment itself is cancelled", () => {
    // Defence-in-depth: cancelling an assignment now cancels the run too, but
    // runs that predate that fix linger in an actionable-looking state.
    expect(
      getRunNextAction({ status: "in_progress", started_at: "x" }, { actionable: false })
    ).toBeNull()
    expect(
      getRunNextAction({ status: "sent_to_partner" }, { actionable: false })
    ).toBeNull()
  })

  it("changes the wording for a sample, never the action", () => {
    const run = { status: "in_progress", started_at: "x" }
    const prod = getRunNextAction(run)
    const sample = getRunNextAction(run, { isSample: true })
    expect(sample?.key).toBe(prod?.key)
    expect(sample?.descriptionKey).not.toBe(prod?.descriptionKey)
  })
})

describe("isPhaseAtLeast", () => {
  it("reveals a section once its phase is reached, and keeps it after", () => {
    expect(isPhaseAtLeast("offered", "accepted")).toBe(false)
    expect(isPhaseAtLeast("accepted", "accepted")).toBe(true)
    expect(isPhaseAtLeast("done", "accepted")).toBe(true)
  })

  it("shows everything for a cancelled run", () => {
    // What the job WAS is exactly what a partner asks about after a cancel.
    expect(isPhaseAtLeast("cancelled", "in_production")).toBe(true)
  })
})

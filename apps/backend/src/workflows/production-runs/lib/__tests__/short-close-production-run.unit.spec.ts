import { shortCloseDecision } from "../short-close-production-run"

/**
 * #1596 short-close, the counter's half. This reduces what a partner may
 * claim, automatically, so the cases that matter most are the ones where it
 * must NOT fire.
 */
const asOf = new Date("2026-08-30T00:00:00.000Z")
const daysAgo = (n: number) =>
  new Date(asOf.getTime() - n * 86_400_000).toISOString()

const completedRun = (over: Record<string, any> = {}) => ({
  id: "run_1",
  status: "completed",
  quantity: 9,
  produced_quantity: 7,
  short_closed_at: null,
  completed_at: daysAgo(31),
  ...over,
})

describe("shortCloseDecision (#1596)", () => {
  it("closes a run that produced less than ordered and has been quiet 30 days", () => {
    expect(
      shortCloseDecision({ run: completedRun(), lastOutputAt: null, asOf })
    ).toBe("due")
  })

  it("waits while the run is still inside the window", () => {
    expect(
      shortCloseDecision({
        run: completedRun({ completed_at: daysAgo(29) }),
        lastOutputAt: null,
        asOf,
      })
    ).toBe("too_recent")
  })

  it("measures from the LAST OUTPUT CORRECTION, not from completion", () => {
    // Completed 90 days ago, but somebody corrected the output yesterday.
    // Closing now would ignore exactly the evidence the counter is meant to
    // wait for.
    expect(
      shortCloseDecision({
        run: completedRun({ completed_at: daysAgo(90) }),
        lastOutputAt: daysAgo(1),
        asOf,
      })
    ).toBe("too_recent")
  })

  it("never closes a run with no output figure", () => {
    expect(
      shortCloseDecision({
        run: completedRun({ produced_quantity: null }),
        lastOutputAt: null,
        asOf,
      })
    ).toBe("no_output_figure")
  })

  it("never closes a run that reported ZERO produced — that needs a human", () => {
    // Closing at 0 would wipe the whole claim on the strength of a number
    // nobody confirmed.
    expect(
      shortCloseDecision({
        run: completedRun({ produced_quantity: 0 }),
        lastOutputAt: null,
        asOf,
      })
    ).toBe("no_output_figure")
  })

  it("does not close a run that produced everything it was ordered for", () => {
    expect(
      shortCloseDecision({
        run: completedRun({ produced_quantity: 9 }),
        lastOutputAt: null,
        asOf,
      })
    ).toBe("nothing_to_close")
  })

  it("does not close a run that produced MORE than ordered", () => {
    expect(
      shortCloseDecision({
        run: completedRun({ produced_quantity: 12 }),
        lastOutputAt: null,
        asOf,
      })
    ).toBe("nothing_to_close")
  })

  it("leaves an already-closed run alone, so a retry cannot re-stamp it", () => {
    expect(
      shortCloseDecision({
        run: completedRun({ short_closed_at: daysAgo(2) }),
        lastOutputAt: null,
        asOf,
      })
    ).toBe("already_closed")
  })

  it("ignores runs that are not completed", () => {
    for (const status of ["in_progress", "cancelled", "draft", "approved"]) {
      expect(
        shortCloseDecision({
          run: completedRun({ status }),
          lastOutputAt: null,
          asOf,
        })
      ).toBe("not_completed")
    }
  })

  it("does not treat a MISSING date as 'long ago'", () => {
    expect(
      shortCloseDecision({
        run: completedRun({ completed_at: null }),
        lastOutputAt: null,
        asOf,
      })
    ).toBe("no_clock")
  })

  it("refuses a run with no readable ordered quantity rather than guessing one", () => {
    expect(
      shortCloseDecision({
        run: completedRun({ quantity: null }),
        lastOutputAt: null,
        asOf,
      })
    ).toBe("nothing_to_close")
  })

  it("honours a caller-supplied window", () => {
    expect(
      shortCloseDecision({
        run: completedRun({ completed_at: daysAgo(20) }),
        lastOutputAt: null,
        asOf,
        afterDays: 14,
      })
    ).toBe("due")
  })
})

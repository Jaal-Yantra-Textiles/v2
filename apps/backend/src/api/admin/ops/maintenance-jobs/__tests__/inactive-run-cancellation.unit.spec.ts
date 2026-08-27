import {
  decideExpiringRunWarnings,
  decideInactiveRunCancellations,
  expiryWarningIdempotencyKey,
  inactivityCancelReason,
  lastActivityOf,
} from "../lib/inactive-run-cancellation"

const ASOF = new Date("2026-08-27T00:00:00.000Z")
const decide = (runs: any[], days = 28) =>
  decideInactiveRunCancellations(runs, { asOf: ASOF, days })

/**
 * #1574 — the fixtures below are REAL prod rows, not invented ones. Both were
 * live on 2026-08-27 and they disagree about what "old" means, which is the
 * whole reason this function exists.
 */
describe("lastActivityOf", () => {
  it("prefers a re-dispatch over the creation date", () => {
    // 🔴 prod_run_01KSHBWQ2GEG6GZ26Q3MAWFCT4 — created 2026-05-26 (93 days) and
    // re-dispatched 2026-08-21 (6 days). A sweep keyed on `created_at` would
    // cancel live work out from under a partner who picked it up last week.
    const last = lastActivityOf({
      id: "prod_run_01KSHBWQ2GEG6GZ26Q3MAWFCT4",
      status: "sent_to_partner",
      created_at: "2026-05-26T05:25:03.184Z",
      dispatch_started_at: "2026-08-21T09:33:34.936Z",
      accepted_at: null,
      started_at: null,
    })
    expect(last?.field).toBe("dispatch_started_at")
  })

  it("falls back to creation for a run nothing ever happened to", () => {
    // prod_run_01KTDS2N5DFWD6NNAPE220PD9T — in_progress since 2026-06-06 with
    // no dispatch, no accept, no start. Inactive from the moment it existed.
    const last = lastActivityOf({
      id: "prod_run_01KTDS2N5DFWD6NNAPE220PD9T",
      status: "in_progress",
      created_at: "2026-06-06T06:14:13.421Z",
    })
    expect(last?.field).toBe("created_at")
  })

  it("takes the LATEST stamp, whichever it is", () => {
    expect(
      lastActivityOf({
        id: "r",
        created_at: "2026-01-01T00:00:00Z",
        dispatch_started_at: "2026-02-01T00:00:00Z",
        accepted_at: "2026-03-01T00:00:00Z",
        started_at: "2026-04-01T00:00:00Z",
        finished_at: "2026-05-01T00:00:00Z",
      })?.field
    ).toBe("finished_at")
  })
})

describe("decideInactiveRunCancellations", () => {
  it("cancels the abandoned run and spares the re-dispatched one", () => {
    // The two real rows together. Exactly one of them should go.
    const decisions = decide([
      {
        id: "prod_run_01KSHBWQ2GEG6GZ26Q3MAWFCT4",
        status: "sent_to_partner",
        created_at: "2026-05-26T05:25:03.184Z",
        dispatch_started_at: "2026-08-21T09:33:34.936Z",
      },
      {
        id: "prod_run_01KTDS2N5DFWD6NNAPE220PD9T",
        status: "in_progress",
        created_at: "2026-06-06T06:14:13.421Z",
      },
    ])

    expect(decisions.map((d) => d.id)).toEqual([
      "prod_run_01KTDS2N5DFWD6NNAPE220PD9T",
    ])
    expect(decisions[0].inactive_days).toBe(81)
    expect(decisions[0].last_activity_field).toBe("created_at")
  })

  it("leaves terminal runs alone", () => {
    // 105 of the 122 prod runs are completed or cancelled. A sweep that
    // re-cancelled them would emit 105 partner emails saying their finished
    // work had been called off.
    expect(
      decide([
        { id: "a", status: "completed", created_at: "2026-01-01T00:00:00Z" },
        { id: "b", status: "cancelled", created_at: "2026-01-01T00:00:00Z" },
      ])
    ).toEqual([])
  })

  it("leaves admin-side states alone", () => {
    // ⚠️ `approved` and `awaiting_reassignment` are not partner inactivity —
    // no partner has been given the work yet, or it has been taken back. A
    // sweep cancelling those would be making a scheduling decision that is not
    // its to make; prod has 6 and 3 of them respectively.
    expect(
      decide([
        { id: "a", status: "approved", created_at: "2026-01-01T00:00:00Z" },
        {
          id: "b",
          status: "awaiting_reassignment",
          created_at: "2026-01-01T00:00:00Z",
        },
      ])
    ).toEqual([])
  })

  it("does not cancel on the boundary day", () => {
    // 🔴 Exactly 28 days is still within the window. Off-by-one here cancels a
    // partner's work a day early, and the partner is the one who finds out.
    const at28 = new Date(ASOF.getTime() - 28 * 86400_000 + 60_000)
    expect(
      decide([
        { id: "a", status: "in_progress", created_at: at28.toISOString() },
      ])
    ).toEqual([])

    const at29 = new Date(ASOF.getTime() - 29 * 86400_000)
    expect(
      decide([
        { id: "a", status: "in_progress", created_at: at29.toISOString() },
      ]).map((d) => d.id)
    ).toEqual(["a"])
  })

  it("reports the most inactive first", () => {
    const mk = (id: string, days: number) => ({
      id,
      status: "in_progress",
      created_at: new Date(ASOF.getTime() - days * 86400_000).toISOString(),
    })
    expect(decide([mk("young", 30), mk("old", 90)]).map((d) => d.id)).toEqual([
      "old",
      "young",
    ])
  })

  it("skips a run with no usable timestamp rather than guessing", () => {
    expect(decide([{ id: "a", status: "in_progress" }])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The warning that comes BEFORE the cancellation (#1574)
// ---------------------------------------------------------------------------

describe("decideExpiringRunWarnings", () => {
  const warn = (runs: any[], days = 28, warnBeforeDays = 7) =>
    decideExpiringRunWarnings(runs, { asOf: ASOF, days, warnBeforeDays })

  const at = (daysAgo: number) =>
    new Date(ASOF.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString()

  const run = (id: string, daysAgo: number, status = "in_progress") => ({
    id,
    status,
    created_at: at(daysAgo),
  })

  it("warns inside the lead-time and names the cancellation date", () => {
    const [d] = warn([run("r_24d", 24)])
    expect(d.id).toBe("r_24d")
    expect(d.inactive_days).toBe(24)
    expect(d.days_until_cancel).toBe(4)
    // 24 days idle + a 28-day window = cancellable four days from ASOF.
    expect(d.cancel_on).toBe("2026-08-31")
  })

  it("stays silent on work that is still fresh", () => {
    // Day 20 is outside a 7-day lead on a 28-day window.
    expect(warn([run("r_20d", 20)])).toEqual([])
  })

  it("🔑 does NOT warn about a run the sweep would cancel in the same pass", () => {
    // The two sets must be disjoint, or the partner is warned about a deadline
    // that has already passed — a notice arriving after the verdict.
    const runs = [run("r_81d", 81), run("r_28d", 28)]
    expect(warn(runs)).toEqual([])
    expect(decide(runs).map((d) => d.id)).toEqual(["r_81d", "r_28d"])
  })

  it("leaves admin-side and terminal states alone, like the sweep", () => {
    expect(
      warn([
        run("r_approved", 24, "approved"),
        run("r_reassign", 24, "awaiting_reassignment"),
        run("r_completed", 24, "completed"),
        run("r_cancelled", 24, "cancelled"),
      ])
    ).toEqual([])
  })

  it("measures from the last lifecycle stamp, not creation", () => {
    // Re-dispatched 24 days ago: it is the dispatch that puts it in the window,
    // and a warning quoting the 93-day creation date would be unanswerable.
    const [d] = warn([
      {
        id: "r_redispatched",
        status: "sent_to_partner",
        created_at: at(93),
        dispatch_started_at: at(24),
      },
    ])
    expect(d.last_activity_field).toBe("dispatch_started_at")
    expect(d.inactive_days).toBe(24)
  })

  it("clamps a lead-time that would reach back past day zero", () => {
    // warn_before_days >= days would start the window at or before the moment
    // of dispatch and warn about work handed over this morning.
    expect(warn([run("r_today", 0)], 28, 999)).toEqual([])
    expect(warn([run("r_today", 0)], 28, 28)).toEqual([])
    // …while a run genuinely inside the widened window is still warned.
    expect(warn([run("r_2d", 2)], 28, 27).map((d) => d.id)).toEqual(["r_2d"])
  })

  it("rounds days_until_cancel UP so a deadline never lands early", () => {
    // 23.5 days idle ⇒ 4.5 days left. Saying "4" would expire the run half a
    // day before the partner expects it to.
    const [d] = warn([
      { id: "r_half", status: "in_progress", created_at: at(23.5) },
    ])
    expect(d.days_until_cancel).toBe(5)
  })

  it("puts the most urgent first", () => {
    expect(
      warn([run("r_22d", 22), run("r_27d", 27), run("r_24d", 24)]).map(
        (d) => d.id
      )
    ).toEqual(["r_27d", "r_24d", "r_22d"])
  })
})

describe("expiryWarningIdempotencyKey", () => {
  it("is keyed on the deadline, not the day it was sent", () => {
    // Re-running the sweep must not re-mail; a NEW deadline must.
    expect(expiryWarningIdempotencyKey("prod_run_1", "2026-08-31")).toBe(
      "partner-run-expiring:prod_run_1:2026-08-31"
    )
    expect(expiryWarningIdempotencyKey("prod_run_1", "2026-08-31")).toBe(
      expiryWarningIdempotencyKey("prod_run_1", "2026-08-31")
    )
    expect(expiryWarningIdempotencyKey("prod_run_1", "2026-09-14")).not.toBe(
      expiryWarningIdempotencyKey("prod_run_1", "2026-08-31")
    )
  })
})

describe("inactivityCancelReason", () => {
  it("states the run's own age — the prod case is 81 days, not the 28-day rule", () => {
    expect(inactivityCancelReason(81)).toContain("81 days")
  })
})

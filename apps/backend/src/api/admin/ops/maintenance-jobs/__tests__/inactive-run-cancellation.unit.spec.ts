import {
  decideInactiveRunCancellations,
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

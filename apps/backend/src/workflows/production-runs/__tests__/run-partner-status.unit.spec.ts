import {
  aggregatePartnerStatus,
  deriveRunPartnerStatus,
} from "../lib/run-partner-status"

/**
 * #1574 — an admin cancels a production run and the order goes on rendering as
 * live work. `deriveRunPartnerStatus` returned `undefined` for that case, and
 * the mirror writes only truthy values, so `partner_status` was never cleared:
 * it kept `accepted` / `in_progress` / `finished` forever.
 *
 * `undefined` meant "don't write" where it needed to mean "say it stopped" —
 * the #1565 shape again, one absent value standing for several answers.
 *
 * The core `order.status` was always right (`RUN_TO_CORE_STATUS` maps
 * cancelled → canceled). It is the sidecar the partner panels read that lied,
 * which is why the order looked half-finished rather than cancelled.
 */
describe("deriveRunPartnerStatus", () => {
  it("says cancelled when an admin cancels — it used to say nothing at all", () => {
    // 🔴 The assertion that fails on the old code: `undefined`, which the
    // caller reads as "leave the last value alone".
    expect(deriveRunPartnerStatus({ status: "cancelled" })).toBe("cancelled")
  })

  it("still says declined when the PARTNER refused the work", () => {
    // Both end the job; only one of them is the partner's doing, and a panel
    // showing "declined" for an admin cancel accuses them of something they
    // did not do.
    expect(
      deriveRunPartnerStatus({ status: "cancelled" }, { declined: true })
    ).toBe("declined")
  })

  it("leaves the live vocabulary untouched", () => {
    expect(deriveRunPartnerStatus({ status: "sent_to_partner" })).toBe("assigned")
    expect(
      deriveRunPartnerStatus({ status: "in_progress", accepted_at: new Date() })
    ).toBe("accepted")
    expect(
      deriveRunPartnerStatus({ status: "in_progress", started_at: new Date() })
    ).toBe("in_progress")
    expect(
      deriveRunPartnerStatus({ status: "in_progress", finished_at: new Date() })
    ).toBe("finished")
    expect(deriveRunPartnerStatus({ status: "completed" })).toBe("completed")
  })

  it("says nothing for a run no partner has been given yet", () => {
    // draft / approved / pending_review are absent from §5 on purpose — there
    // is no partner-facing progress to report, which is a different answer
    // from "the work stopped".
    expect(deriveRunPartnerStatus({ status: "draft" })).toBeUndefined()
    expect(deriveRunPartnerStatus({ status: "approved" })).toBeUndefined()
  })
})

describe("aggregatePartnerStatus", () => {
  it("cancels the order only when EVERY run is cancelled", () => {
    // ⚠️ The multi-run half of the same hole: the old code mapped each run and
    // did `.filter(Boolean)`, so an all-cancelled order produced an empty list
    // ⇒ undefined ⇒ no write, exactly as in the single-run case.
    expect(
      aggregatePartnerStatus([{ status: "cancelled" }, { status: "cancelled" }])
    ).toBe("cancelled")
  })

  it("does not let one cancelled run drag a live order backwards", () => {
    // 🔴 The counter-case, and the one that makes the fix safe to deploy. Four
    // runs in flight and one cancelled is an order still being worked on. If
    // "cancelled" joined the progress ordering it would sort below everything
    // and retire an order mid-production.
    expect(
      aggregatePartnerStatus([
        { status: "cancelled" },
        { status: "in_progress", started_at: new Date() },
      ])
    ).toBe("in_progress")
  })

  it("does not call an undispatched order cancelled", () => {
    // 🔴 Why the all-cancelled test reads `run.status` rather than counting
    // derived values. A draft run also derives `undefined`, so "the derived
    // list is empty" could mean "all cancelled" OR "nothing dispatched yet" —
    // and retiring an order nobody has started is the worse of the two.
    expect(
      aggregatePartnerStatus([{ status: "draft" }, { status: "approved" }])
    ).toBeUndefined()
  })

  it("still reports the least-advanced run of a live order", () => {
    expect(
      aggregatePartnerStatus([
        { status: "in_progress", finished_at: new Date() },
        { status: "sent_to_partner" },
      ])
    ).toBe("assigned")
  })

  it("says nothing for an order with no runs", () => {
    expect(aggregatePartnerStatus([])).toBeUndefined()
  })
})

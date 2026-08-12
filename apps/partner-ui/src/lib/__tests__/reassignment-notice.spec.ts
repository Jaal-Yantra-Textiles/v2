import { describe, expect, it } from "vitest"

import { getReassignmentNotice } from "../reassignment-notice"

describe("getReassignmentNotice", () => {
  it("says nothing about a run that arrived normally", () => {
    expect(
      getReassignmentNotice({ status: "sent_to_partner" }, "part_me")
    ).toBeNull()
  })

  it("warns a partner who is on a re-sent dispatch they haven't accepted", () => {
    const notice = getReassignmentNotice(
      { status: "sent_to_partner", reassign_retry_count: 1 },
      "part_me"
    )
    expect(notice?.variant).toBe("warning")
    expect(notice?.title).toBe("This run was sent to you again")
  })

  it("drops the re-send warning once the partner has accepted", () => {
    expect(
      getReassignmentNotice(
        {
          status: "in_progress",
          reassign_retry_count: 1,
          accepted_at: "2026-08-12T00:00:00.000Z",
        },
        "part_me"
      )
    ).toBeNull()
  })

  it("tells a partner when a run was re-assigned to them from someone else", () => {
    const notice = getReassignmentNotice(
      { status: "sent_to_partner", previous_partner_id: "part_other" },
      "part_me"
    )
    expect(notice?.variant).toBe("info")
    expect(notice?.title).toBe("Re-assigned to you")
  })

  it("does not call it a re-assignment when the run came back to the same partner", () => {
    expect(
      getReassignmentNotice(
        { status: "sent_to_partner", previous_partner_id: "part_me" },
        "part_me"
      )
    ).toBeNull()
  })

  it("prefers the last-chance warning over the inherited-work note", () => {
    const notice = getReassignmentNotice(
      {
        status: "sent_to_partner",
        previous_partner_id: "part_other",
        reassign_retry_count: 2,
      },
      "part_me"
    )
    expect(notice?.title).toBe("This run was sent to you again")
  })

  it("flags a parked run as no longer theirs", () => {
    const notice = getReassignmentNotice(
      { status: "awaiting_reassignment", previous_partner_id: "part_me" },
      "part_me"
    )
    expect(notice?.title).toBe("No longer assigned to you")
  })

  it("stays quiet on finished or cancelled work", () => {
    for (const status of ["completed", "cancelled"]) {
      expect(
        getReassignmentNotice(
          { status, previous_partner_id: "part_other", reassign_retry_count: 3 },
          "part_me"
        )
      ).toBeNull()
    }
  })

  it("handles a missing run", () => {
    expect(getReassignmentNotice(null, "part_me")).toBeNull()
  })
})

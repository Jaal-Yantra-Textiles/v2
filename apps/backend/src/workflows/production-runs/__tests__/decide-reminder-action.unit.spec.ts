import {
  decideReminderAction,
  REMINDER_CAP,
} from "../emit-production-run-reminder"

describe("decideReminderAction (#1093 reminder cap state machine)", () => {
  it("first reminder in a fresh bucket → reminded, count 1", () => {
    expect(
      decideReminderAction(
        { reminder_kind: null, reminder_count: 0, reminder_status: null },
        "assignment_pending"
      )
    ).toEqual({ action: "reminded", nextCount: 1 })
  })

  it("second reminder (count 1) → reminded, count 2 (still under cap)", () => {
    expect(
      decideReminderAction(
        { reminder_kind: "assignment_pending", reminder_count: 1, reminder_status: "active" },
        "assignment_pending"
      )
    ).toEqual({ action: "reminded", nextCount: 2 })
  })

  it("cap reached on assignment_pending → reassigned", () => {
    expect(
      decideReminderAction(
        { reminder_kind: "assignment_pending", reminder_count: REMINDER_CAP, reminder_status: "active" },
        "assignment_pending"
      )
    ).toEqual({ action: "reassigned", nextCount: REMINDER_CAP })
  })

  it("cap reached on not_started (already accepted) → escalated, not reassigned", () => {
    expect(
      decideReminderAction(
        { reminder_kind: "not_started", reminder_count: REMINDER_CAP, reminder_status: "active" },
        "not_started"
      )
    ).toEqual({ action: "escalated", nextCount: REMINDER_CAP })
  })

  it("cap reached on idle → escalated", () => {
    const d = decideReminderAction(
      { reminder_kind: "idle", reminder_count: 5, reminder_status: "active" },
      "idle"
    )
    expect(d.action).toBe("escalated")
  })

  it("already escalated for the same kind → skipped (no repeat)", () => {
    expect(
      decideReminderAction(
        { reminder_kind: "idle", reminder_count: REMINDER_CAP, reminder_status: "escalated" },
        "idle"
      )
    ).toEqual({ action: "skipped", nextCount: REMINDER_CAP })
  })

  it("bucket transition resets the count — accepted run's stale pending count is ignored", () => {
    // Run was reminded twice while assignment_pending, then accepted → now
    // classified not_started. Stored kind differs → fresh cycle from 0.
    expect(
      decideReminderAction(
        { reminder_kind: "assignment_pending", reminder_count: 2, reminder_status: "active" },
        "not_started"
      )
    ).toEqual({ action: "reminded", nextCount: 1 })
  })

  it("a differing prior escalation does NOT block a new bucket", () => {
    // Escalated on not_started, but now the run is idle → different bucket,
    // so the escalation guard is skipped and the new cycle starts.
    expect(
      decideReminderAction(
        { reminder_kind: "not_started", reminder_count: 9, reminder_status: "escalated" },
        "idle"
      )
    ).toEqual({ action: "reminded", nextCount: 1 })
  })

  it("post-reassign reset state (count 0, kind null, status closed) → fresh reminder for the new partner", () => {
    expect(
      decideReminderAction(
        { reminder_kind: null, reminder_count: 0, reminder_status: "closed" },
        "assignment_pending"
      )
    ).toEqual({ action: "reminded", nextCount: 1 })
  })

  it("respects a custom cap", () => {
    expect(
      decideReminderAction(
        { reminder_kind: "assignment_pending", reminder_count: 1, reminder_status: "active" },
        "assignment_pending",
        1
      ).action
    ).toBe("reassigned")
  })
})

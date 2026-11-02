import { classifyPartnerReminderKind } from "../lib/run-bundle"

const NOW = new Date("2026-11-05T04:30:00Z").getTime()
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

describe("classifyPartnerReminderKind (#2500) — same rules as the reminder flow", () => {
  it("unaccepted for a day or more → assignment_pending", () => {
    expect(classifyPartnerReminderKind({ status: "sent_to_partner", created_at: daysAgo(1) }, NOW)).toBe(
      "assignment_pending"
    )
    expect(classifyPartnerReminderKind({ status: "sent_to_partner", created_at: daysAgo(0.5) }, NOW)).toBeNull()
  })

  it("accepted a day ago and not started → not_started", () => {
    expect(
      classifyPartnerReminderKind({ status: "sent_to_partner", created_at: daysAgo(5), accepted_at: daysAgo(2) }, NOW)
    ).toBe("not_started")
  })

  it("in progress three days without finishing → idle", () => {
    expect(
      classifyPartnerReminderKind(
        { status: "in_progress", created_at: daysAgo(9), accepted_at: daysAgo(8), started_at: daysAgo(3) },
        NOW
      )
    ).toBe("idle")
    expect(
      classifyPartnerReminderKind(
        { status: "in_progress", created_at: daysAgo(9), accepted_at: daysAgo(8), started_at: daysAgo(2) },
        NOW
      )
    ).toBeNull()
  })
})

import {
  decideParkedEscalation,
  PARKED_ESCALATION_INTERVAL_DAYS,
} from "../emit-production-run-reminder"

/**
 * #1279 — `awaiting_reassignment` was terminal in practice. The reminder flow
 * read only `sent_to_partner`/`in_progress`, so the moment the cap parked a
 * run, the machinery that parked it could no longer see it. Six runs sat that
 * way until a human noticed, the oldest for 4.5 months.
 *
 * The two failure modes this must avoid are opposites, which is why the rule
 * is a cadence rather than a cap:
 *   - escalate once and go quiet  → recreates the original bug
 *   - escalate every single day    → the channel gets muted, same outcome
 */

const NOW = new Date("2026-08-12T05:00:00.000Z")
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString()

describe("decideParkedEscalation", () => {
  it("uses a weekly cadence", () => {
    expect(PARKED_ESCALATION_INTERVAL_DAYS).toBe(7)
  })

  it("escalates a run that has never been escalated", () => {
    const out = decideParkedEscalation(
      { reminder_kind: null, reminder_status: "closed", last_reminded_at: null },
      NOW
    )
    expect(out.action).toBe("escalated")
    expect(out.reason).toBeNull()
  })

  it("stays quiet inside the interval", () => {
    const out = decideParkedEscalation(
      {
        reminder_kind: "awaiting_reassignment",
        reminder_status: "escalated",
        last_reminded_at: daysAgo(3),
      },
      NOW
    )
    expect(out).toMatchObject({ action: "skipped", reason: "escalated_recently" })
  })

  it("escalates again once the interval has passed — told once is how runs get lost", () => {
    const out = decideParkedEscalation(
      {
        reminder_kind: "awaiting_reassignment",
        reminder_status: "escalated",
        last_reminded_at: daysAgo(8),
      },
      NOW
    )
    expect(out.action).toBe("escalated")
  })

  it("is not silenced by `escalated` status the way the partner buckets are", () => {
    // decideReminderAction returns `skipped` forever on reminder_status
    // "escalated". Reusing it here would have reproduced the bug being fixed.
    const out = decideParkedEscalation(
      {
        reminder_kind: "awaiting_reassignment",
        reminder_status: "escalated",
        last_reminded_at: daysAgo(30),
      },
      NOW
    )
    expect(out.action).toBe("escalated")
  })

  it("ignores a stale last_reminded_at left over from the partner cycle", () => {
    // Parking sets reminder_kind to null but does NOT clear last_reminded_at,
    // so a run parked yesterday can carry a timestamp from the partner nags.
    // Reading it as ours would silence the first admin escalation for a week.
    const out = decideParkedEscalation(
      {
        reminder_kind: null,
        reminder_status: "closed",
        last_reminded_at: daysAgo(1),
      },
      NOW
    )
    expect(out.action).toBe("escalated")
  })

  it("reports how long the run has been parked, for a message that sharpens over time", () => {
    const out = decideParkedEscalation(
      { reminder_kind: null, last_reminded_at: null, updated_at: daysAgo(135) },
      NOW
    )
    expect(out.parked_days).toBe(135)
  })

  it("reports 0 parked days rather than guessing when the timestamp is unusable", () => {
    expect(
      decideParkedEscalation({ updated_at: null, last_reminded_at: null }, NOW).parked_days
    ).toBe(0)
    expect(
      decideParkedEscalation({ updated_at: "not-a-date", last_reminded_at: null }, NOW)
        .parked_days
    ).toBe(0)
  })

  it("honours a custom interval", () => {
    const run = {
      reminder_kind: "awaiting_reassignment",
      last_reminded_at: daysAgo(2),
    }
    expect(decideParkedEscalation(run, NOW, 7).action).toBe("skipped")
    expect(decideParkedEscalation(run, NOW, 1).action).toBe("escalated")
  })
})

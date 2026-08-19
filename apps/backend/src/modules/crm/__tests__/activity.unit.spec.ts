import {
  DEFAULT_ENGAGEMENT_POLICY,
  deriveEngagement,
  followUpDate,
  isContactable,
  summarizeActivity,
  type EngagementActivity,
} from "../activity"

const NOW = "2026-08-19T12:00:00.000Z"
const daysAgo = (n: number) =>
  new Date(Date.parse(NOW) - n * 24 * 60 * 60 * 1000).toISOString()

const act = (
  direction: string,
  occurred_at: string,
  over: Partial<EngagementActivity> = {}
): EngagementActivity => ({
  direction,
  occurred_at,
  activity_type: "message",
  channel: "whatsapp",
  ...over,
})

const derive = (
  activities: EngagementActivity[],
  scheduledFollowUpAt?: string | null
) => deriveEngagement(activities, { now: NOW, scheduledFollowUpAt })

describe("deriveEngagement", () => {
  it("is not_contacted with no activity at all", () => {
    const s = derive([])
    expect(s.engagement_state).toBe("not_contacted")
    expect(s.last_activity_at).toBeNull()
    expect(s.outbound_attempts).toBe(0)
  })

  it("treats an internal note as no contact — nobody has been reached", () => {
    // The whole reason `internal` exists as a third direction. If notes counted
    // as outreach, writing a note would make a contact look worked.
    const s = derive([act("internal", daysAgo(1), { activity_type: "note" })])
    expect(s.engagement_state).toBe("not_contacted")
    expect(s.outbound_attempts).toBe(0)
  })

  it("is awaiting_reply after we reach out", () => {
    const s = derive([act("outbound", daysAgo(2))])
    expect(s.engagement_state).toBe("awaiting_reply")
    expect(s.outbound_attempts).toBe(1)
  })

  it("is in_conversation once they reply", () => {
    const s = derive([act("outbound", daysAgo(3)), act("inbound", daysAgo(1))])
    expect(s.engagement_state).toBe("in_conversation")
  })

  it("is in_conversation for an unsolicited inbound enquiry", () => {
    // An enquiry with no prior outreach: the ball is with us from the start.
    const s = derive([act("inbound", daysAgo(1))])
    expect(s.engagement_state).toBe("in_conversation")
  })

  it("resets the attempt count when they reply", () => {
    // Otherwise a contact who replies after two chases is permanently two
    // attempts closer to being written off as stalled.
    const s = derive([
      act("outbound", daysAgo(30)),
      act("outbound", daysAgo(25)),
      act("inbound", daysAgo(20)),
      act("outbound", daysAgo(2)),
    ])
    expect(s.outbound_attempts).toBe(1)
    expect(s.engagement_state).toBe("awaiting_reply")
  })

  it("sorts activities itself rather than trusting the caller's order", () => {
    // The CRM list endpoint gives no ordering guarantee, and a mis-ordered log
    // would invert "who spoke last" — the fact everything else turns on.
    const shuffled = [act("inbound", daysAgo(1)), act("outbound", daysAgo(5))]
    expect(derive(shuffled).engagement_state).toBe("in_conversation")
    expect(derive([...shuffled].reverse()).engagement_state).toBe("in_conversation")
  })

  it("ignores activities with an unparseable occurred_at", () => {
    const s = derive([act("outbound", "not-a-date"), act("outbound", daysAgo(1))])
    expect(s.outbound_attempts).toBe(1)
  })

  describe("stalling", () => {
    it("needs BOTH enough attempts and enough silence", () => {
      const { maxAttempts, stallAfterDays } = DEFAULT_ENGAGEMENT_POLICY

      // Enough attempts, but the last one was recent.
      const recent = derive(
        Array.from({ length: maxAttempts }, (_, i) => act("outbound", daysAgo(i + 1)))
      )
      expect(recent.engagement_state).toBe("awaiting_reply")

      // Long silence, but only one attempt — not yet a pattern.
      const oneOld = derive([act("outbound", daysAgo(stallAfterDays + 5))])
      expect(oneOld.engagement_state).toBe("awaiting_reply")

      // Both.
      const stalled = derive(
        Array.from({ length: maxAttempts }, (_, i) =>
          act("outbound", daysAgo(stallAfterDays + 5 + i))
        )
      )
      expect(stalled.engagement_state).toBe("stalled")
    })
  })

  describe("follow-ups", () => {
    it("is follow_up_due once the scheduled time passes", () => {
      const s = derive([act("outbound", daysAgo(5))], daysAgo(1))
      expect(s.engagement_state).toBe("follow_up_due")
    })

    it("stays awaiting_reply while the follow-up is still in the future", () => {
      const future = new Date(Date.parse(NOW) + 86_400_000).toISOString()
      const s = derive([act("outbound", daysAgo(5))], future)
      expect(s.engagement_state).toBe("awaiting_reply")
    })

    it("outranks stalling — an instruction beats a heuristic", () => {
      const { maxAttempts, stallAfterDays } = DEFAULT_ENGAGEMENT_POLICY
      const s = derive(
        Array.from({ length: maxAttempts }, (_, i) =>
          act("outbound", daysAgo(stallAfterDays + 5 + i))
        ),
        daysAgo(1)
      )
      expect(s.engagement_state).toBe("follow_up_due")
    })

    it("does not fire a follow-up while they are mid-conversation", () => {
      // They replied; chasing them on a stale timer is the classic
      // automation embarrassment.
      const s = derive(
        [act("outbound", daysAgo(5)), act("inbound", daysAgo(1))],
        daysAgo(2)
      )
      expect(s.engagement_state).toBe("in_conversation")
    })
  })

  describe("terminal states", () => {
    it("do_not_contact outranks everything", () => {
      const s = derive(
        [
          act("outbound", daysAgo(10)),
          act("inbound", daysAgo(5), { kind: "opt_out" }),
        ],
        daysAgo(1)
      )
      expect(s.engagement_state).toBe("do_not_contact")
      // A pending follow-up must not survive an opt-out, or the sweep would
      // keep re-raising somebody who asked to be left alone.
      expect(s.next_follow_up_at).toBeNull()
    })

    it("never lets a later message revive an opt-out", () => {
      // Consent has to be given again explicitly, not inferred from traffic.
      const s = derive([
        act("inbound", daysAgo(10), { kind: "unsubscribed" }),
        act("inbound", daysAgo(1)),
      ])
      expect(s.engagement_state).toBe("do_not_contact")
    })

    it("lets a later inbound reopen a merely-closed conversation", () => {
      // Unlike an opt-out, `closed` is our own decision and they can undo it
      // by getting back in touch.
      const s = derive([
        act("internal", daysAgo(10), { kind: "closed" }),
        act("inbound", daysAgo(1)),
      ])
      expect(s.engagement_state).toBe("in_conversation")
    })
  })
})

describe("isContactable", () => {
  it("blocks the two terminal states and allows the rest", () => {
    expect(isContactable("do_not_contact")).toBe(false)
    expect(isContactable("closed")).toBe(false)
    expect(isContactable("awaiting_reply")).toBe(true)
    expect(isContactable("stalled")).toBe(true)
  })

  it("treats an unset state as contactable, not as a block", () => {
    // A contact created before this field existed must not become permanently
    // unreachable by automation.
    expect(isContactable(null)).toBe(true)
    expect(isContactable(undefined)).toBe(true)
  })
})

describe("followUpDate", () => {
  it("adds whole days in UTC", () => {
    expect(followUpDate(NOW, 3)).toBe("2026-08-22T12:00:00.000Z")
  })
})

describe("summarizeActivity", () => {
  it("reads as a timeline line, with direction and channel", () => {
    expect(
      summarizeActivity({ direction: "inbound", channel: "whatsapp", kind: "reply" })
    ).toBe("Received whatsapp: reply")
    expect(
      summarizeActivity({ direction: "outbound", channel: "email", subject: "Quote" })
    ).toBe("Sent email: Quote")
  })

  it("does not invent a channel for an internal entry", () => {
    expect(
      summarizeActivity({ direction: "internal", activity_type: "note" })
    ).toBe("Logged: note")
  })
})

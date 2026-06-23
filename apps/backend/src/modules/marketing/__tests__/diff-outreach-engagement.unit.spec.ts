import {
  diffOutreachEngagement,
  type OutreachEngagementRow,
  type OutreachProviderEvent,
} from "../diff-outreach-engagement"

const baseRow = (
  over: Partial<OutreachEngagementRow> = {}
): OutreachEngagementRow => ({
  id: "mko_1",
  status: "queued",
  sent_at: null,
  opened_at: null,
  replied_at: null,
  bounce_unreliable: false,
  ...over,
})

describe("diffOutreachEngagement", () => {
  it("advances queued → sent and stamps sent_at", () => {
    const event: OutreachProviderEvent = { sent_at: "2026-06-20T10:00:00Z" }
    const { changes, patch, nextStatus } = diffOutreachEngagement(baseRow(), event)

    expect(nextStatus).toBe("sent")
    expect(patch.status).toBe("sent")
    expect(patch.sent_at).toBeInstanceOf(Date)
    const fields = changes.map((c) => c.field).sort()
    expect(fields).toEqual(["sent_at", "status"])
    expect(changes.every((c) => c.entity === "marketing_outreach" && c.id === "mko_1")).toBe(true)
  })

  it("advances to opened when an open is reported", () => {
    const { patch, nextStatus } = diffOutreachEngagement(
      baseRow({ status: "sent", sent_at: new Date("2026-06-20T10:00:00Z") }),
      { opened_at: "2026-06-21T09:00:00Z" }
    )
    expect(nextStatus).toBe("opened")
    expect(patch.status).toBe("opened")
    expect(patch.opened_at).toBeInstanceOf(Date)
    expect(patch.sent_at).toBeUndefined() // already stamped → not re-written
  })

  it("advances to replied (highest signal)", () => {
    const { patch, nextStatus } = diffOutreachEngagement(baseRow({ status: "opened" }), {
      replied_at: "2026-06-22T08:00:00Z",
    })
    expect(nextStatus).toBe("replied")
    expect(patch.status).toBe("replied")
    expect(patch.replied_at).toBeInstanceOf(Date)
  })

  it("never downgrades a stronger status", () => {
    const { changes, patch, nextStatus } = diffOutreachEngagement(
      baseRow({ status: "replied", replied_at: new Date("2026-06-22T08:00:00Z") }),
      { opened_at: "2026-06-21T09:00:00Z", sent_at: "2026-06-20T10:00:00Z" }
    )
    // status stays replied; opened_at/sent_at get back-filled but status is untouched
    expect(nextStatus).toBe("replied")
    expect(patch.status).toBeUndefined()
    expect(changes.find((c) => c.field === "status")).toBeUndefined()
    expect(patch.opened_at).toBeInstanceOf(Date)
    expect(patch.sent_at).toBeInstanceOf(Date)
  })

  it("on bounce sets status=bounced AND flags bounce_unreliable (never suppresses)", () => {
    const { changes, patch, nextStatus } = diffOutreachEngagement(
      baseRow({ status: "sent" }),
      { bounced_at: "2026-06-21T11:00:00Z" }
    )
    expect(nextStatus).toBe("bounced")
    expect(patch.status).toBe("bounced")
    expect(patch.bounce_unreliable).toBe(true)
    const flag = changes.find((c) => c.field === "bounce_unreliable")
    expect(flag).toEqual({
      entity: "marketing_outreach",
      id: "mko_1",
      field: "bounce_unreliable",
      before: false,
      after: true,
    })
  })

  it("a reply outranks a bounce for status but still flags the bounce signal", () => {
    const { patch, nextStatus } = diffOutreachEngagement(baseRow({ status: "sent" }), {
      bounced_at: "2026-06-21T11:00:00Z",
      replied_at: "2026-06-22T08:00:00Z",
    })
    expect(nextStatus).toBe("replied")
    expect(patch.status).toBe("replied")
    expect(patch.bounce_unreliable).toBe(true) // honesty flag still set
  })

  it("does not re-flag bounce_unreliable when already true", () => {
    const { changes, patch } = diffOutreachEngagement(
      baseRow({ status: "bounced", bounce_unreliable: true }),
      { bounced_at: "2026-06-21T11:00:00Z" }
    )
    expect(patch.bounce_unreliable).toBeUndefined()
    expect(changes.find((c) => c.field === "bounce_unreliable")).toBeUndefined()
  })

  it("is idempotent — re-diffing a fully-synced row yields no changes", () => {
    const row = baseRow({
      status: "replied",
      sent_at: new Date("2026-06-20T10:00:00Z"),
      opened_at: new Date("2026-06-21T09:00:00Z"),
      replied_at: new Date("2026-06-22T08:00:00Z"),
    })
    const event: OutreachProviderEvent = {
      sent_at: "2026-06-20T10:00:00Z",
      opened_at: "2026-06-21T09:00:00Z",
      replied_at: "2026-06-22T08:00:00Z",
    }
    const { changes, patch } = diffOutreachEngagement(row, event)
    expect(changes).toEqual([])
    expect(patch).toEqual({})
  })

  it("treats an empty event as a no-op", () => {
    const { changes, patch, nextStatus } = diffOutreachEngagement(baseRow({ status: "sent" }), {})
    expect(changes).toEqual([])
    expect(patch).toEqual({})
    expect(nextStatus).toBe("sent")
  })

  it("ignores invalid/NaN dates (no signal)", () => {
    const { changes, patch, nextStatus } = diffOutreachEngagement(baseRow(), {
      sent_at: "not-a-date",
      opened_at: null,
    })
    expect(changes).toEqual([])
    expect(patch).toEqual({})
    expect(nextStatus).toBe("queued")
  })

  it("defaults a null status to queued before ranking", () => {
    const { nextStatus, patch } = diffOutreachEngagement(
      baseRow({ status: null }),
      { sent_at: "2026-06-20T10:00:00Z" }
    )
    expect(nextStatus).toBe("sent")
    expect(patch.status).toBe("sent")
  })
})

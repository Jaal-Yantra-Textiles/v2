import {
  firstDeliveredAtFromSentCount,
  mergeKitStats,
} from "../kit-backfill-core"

// Newest first, as the job passes them.
const BROADCASTS = [
  "2026-09-04T03:47:59Z",
  "2026-08-10T10:37:37Z",
  "2026-07-23T08:25:34Z",
]

describe("firstDeliveredAtFromSentCount", () => {
  it("dates the first delivery as the Nth broadcast from the end", () => {
    // Tagged before everything: three sends, first is the oldest broadcast.
    expect(firstDeliveredAtFromSentCount(3, BROADCASTS)).toBe(
      "2026-07-23T08:25:34.000Z"
    )
    // Tagged after the first: two sends.
    expect(firstDeliveredAtFromSentCount(2, BROADCASTS)).toBe(
      "2026-08-10T10:37:37.000Z"
    )
    // Tagged today: one send, the most recent broadcast.
    expect(firstDeliveredAtFromSentCount(1, BROADCASTS)).toBe(
      "2026-09-04T03:47:59.000Z"
    )
  })

  it("returns null when nothing has been sent", () => {
    expect(firstDeliveredAtFromSentCount(0, BROADCASTS)).toBeNull()
  })

  it("returns null rather than guessing when Kit claims more sends than we have broadcasts", () => {
    // Better to leave the span unknown than to invent one — an invented early
    // date is what makes someone wrongly `dormant`.
    expect(firstDeliveredAtFromSentCount(5, BROADCASTS)).toBeNull()
  })
})

describe("mergeKitStats", () => {
  const now = new Date("2026-09-04T04:00:00.000Z")

  it("adds Kit's totals to a row that has never been synced", () => {
    const out = mergeKitStats(
      { delivered_count: 4, opens_count: 2, clicks_count: 0 },
      { sent: 3, opened: 1, clicked: 0, last_sent: "2026-09-04T03:48:02Z", last_opened: "2026-09-04T03:55:00Z", sends_since_last_open: 0 },
      { now }
    )
    // Transactional history (4/2) is preserved, Kit's 3/1 added on top.
    expect(out.delivered_count).toBe(7)
    expect(out.opens_count).toBe(3)
    expect(out.kit_sent).toBe(3)
    expect(out.changed).toBe(true)
  })

  it("is a NO-OP on a re-run with unchanged stats — the whole point of the snapshot", () => {
    const stats = { sent: 3, opened: 1, clicked: 0, last_sent: "2026-09-04T03:48:02Z", last_opened: "2026-09-04T03:55:00Z", sends_since_last_open: 0 }
    const first = mergeKitStats({ delivered_count: 4, opens_count: 2 }, stats, { now })

    const second = mergeKitStats(
      {
        delivered_count: first.delivered_count,
        opens_count: first.opens_count,
        clicks_count: first.clicks_count,
        delivered_since_last_open: first.delivered_since_last_open,
        first_delivered_at: first.first_delivered_at,
        last_delivered_at: first.last_delivered_at,
        last_open_at: first.last_open_at,
        last_click_at: first.last_click_at,
        last_event_at: first.last_event_at,
        kit_sent: first.kit_sent,
        kit_opened: first.kit_opened,
        kit_clicked: first.kit_clicked,
      },
      stats,
      { now }
    )

    expect(second.delivered_count).toBe(first.delivered_count)
    expect(second.opens_count).toBe(first.opens_count)
    expect(second.changed).toBe(false)
  })

  it("applies only the delta when Kit's totals grow", () => {
    const out = mergeKitStats(
      { delivered_count: 7, opens_count: 3, kit_sent: 3, kit_opened: 1 },
      { sent: 4, opened: 1, sends_since_last_open: 1, last_sent: "2026-10-01T09:00:00Z" },
      { now }
    )
    expect(out.delivered_count).toBe(8) // +1, not +4
    expect(out.opens_count).toBe(3) // unchanged
  })

  it("never claws back deliveries when Kit reports LOWER totals", () => {
    // A subscriber deleted and re-created in Kit resets their counters. That
    // must not subtract from what our own webhooks recorded.
    const out = mergeKitStats(
      { delivered_count: 9, opens_count: 4, kit_sent: 5, kit_opened: 2 },
      { sent: 1, opened: 0, sends_since_last_open: 1 },
      { now }
    )
    expect(out.delivered_count).toBe(9)
    expect(out.opens_count).toBe(4)
    // The snapshot still tracks what Kit currently says, so later growth is
    // measured from the new baseline.
    expect(out.kit_sent).toBe(1)
  })

  it("takes the LOWER cold streak when Kit has seen engagement", () => {
    // Neither counter is the whole truth; the smaller one keeps people on the
    // list, matching the conservative bias of the webhook path.
    const out = mergeKitStats(
      { delivered_since_last_open: 6, kit_sent: 0 },
      { sent: 2, opened: 1, sends_since_last_open: 1 },
      { now }
    )
    expect(out.delivered_since_last_open).toBe(1)
  })

  it("grows the cold streak by the delivery delta when Kit has seen no engagement", () => {
    const out = mergeKitStats(
      { delivered_since_last_open: 2, kit_sent: 1 },
      { sent: 3, opened: 0, clicked: 0, sends_since_last_open: 3 },
      { now }
    )
    expect(out.delivered_since_last_open).toBe(4) // 2 + (3 - 1)
  })

  it("treats a click as engagement even with no open date", () => {
    const out = mergeKitStats(
      {},
      { sent: 1, opened: 0, clicked: 1, last_clicked: "2026-09-04T03:59:00Z", sends_since_last_open: 0 },
      { now }
    )
    expect(out.last_open_at).toBe("2026-09-04T03:59:00.000Z")
    expect(out.last_click_at).toBe("2026-09-04T03:59:00.000Z")
  })

  it("keeps the EARLIER first_delivered_at when the row already has one", () => {
    const out = mergeKitStats(
      { first_delivered_at: "2026-01-01T00:00:00Z" },
      { sent: 1, sends_since_last_open: 1 },
      { firstDeliveredAt: "2026-07-23T08:25:34Z", now }
    )
    expect(out.first_delivered_at).toBe("2026-01-01T00:00:00.000Z")
  })

  it("adopts the derived first_delivered_at when the row has none", () => {
    const out = mergeKitStats(
      {},
      { sent: 3, sends_since_last_open: 3 },
      { firstDeliveredAt: "2026-07-23T08:25:34Z", now }
    )
    expect(out.first_delivered_at).toBe("2026-07-23T08:25:34.000Z")
  })
})

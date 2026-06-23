import {
  reconcileOutreachBatch,
  selectSyncableOutreach,
  summarizeOutreachSync,
  type OutreachSyncEvent,
  type OutreachSyncRow,
} from "../outreach-sync-lib"

/**
 * #659 slice 4 / PR-4d — batch engagement reconciliation (pure).
 * Verifies matching (id + external_id), forward-only folding, idempotency,
 * candidate selection, and summary wording without a DB or provider.
 */

const row = (over: Partial<OutreachSyncRow> = {}): OutreachSyncRow => ({
  id: "or_1",
  status: "queued",
  sent_at: null,
  opened_at: null,
  replied_at: null,
  bounce_unreliable: null,
  external_id: "msg_1",
  ...over,
})

describe("reconcileOutreachBatch", () => {
  it("matches by row id, advances status and fills timestamps", () => {
    const rows = [row()]
    const events: OutreachSyncEvent[] = [
      { id: "or_1", opened_at: "2026-06-23T10:00:00.000Z" },
    ]

    const res = reconcileOutreachBatch(rows, events)

    expect(res.matchedRowIds).toEqual(["or_1"])
    expect(res.unmatchedEvents).toBe(0)
    expect(res.items).toHaveLength(1)
    expect(res.items[0].patch.status).toBe("opened")
    expect(res.items[0].patch.opened_at).toBeInstanceOf(Date)
    // status + opened_at = 2 field changes
    expect(res.changes).toHaveLength(2)
  })

  it("matches by external_id when the event carries no row id", () => {
    const rows = [row({ id: "or_9", external_id: "resend_abc" })]
    const events: OutreachSyncEvent[] = [
      { external_id: "resend_abc", sent_at: "2026-06-23T09:00:00.000Z" },
    ]

    const res = reconcileOutreachBatch(rows, events)

    expect(res.matchedRowIds).toEqual(["or_9"])
    expect(res.items[0].patch.status).toBe("sent")
  })

  it("counts events that match no row without throwing", () => {
    const res = reconcileOutreachBatch(
      [row()],
      [{ id: "nope" }, { external_id: "missing" }]
    )
    expect(res.unmatchedEvents).toBe(2)
    expect(res.items).toHaveLength(0)
    expect(res.changes).toHaveLength(0)
  })

  it("is idempotent — re-applying the same event yields zero changes", () => {
    const already = row({
      status: "opened",
      sent_at: new Date("2026-06-23T09:00:00.000Z"),
      opened_at: new Date("2026-06-23T10:00:00.000Z"),
    })
    const res = reconcileOutreachBatch(already ? [already] : [], [
      { id: "or_1", opened_at: "2026-06-23T10:00:00.000Z" },
    ])
    expect(res.items).toHaveLength(0)
    expect(res.changes).toHaveLength(0)
  })

  it("folds multiple events for one row forward-only", () => {
    const rows = [row()]
    const events: OutreachSyncEvent[] = [
      { id: "or_1", sent_at: "2026-06-23T08:00:00.000Z" },
      { id: "or_1", opened_at: "2026-06-23T09:00:00.000Z" },
      { id: "or_1", replied_at: "2026-06-23T10:00:00.000Z" },
    ]

    const res = reconcileOutreachBatch(rows, events)

    expect(res.items).toHaveLength(1)
    expect(res.items[0].nextStatus).toBe("replied")
    expect(res.items[0].patch.status).toBe("replied")
    expect(res.items[0].patch.sent_at).toBeInstanceOf(Date)
    expect(res.items[0].patch.opened_at).toBeInstanceOf(Date)
    expect(res.items[0].patch.replied_at).toBeInstanceOf(Date)
  })

  it("flags a bounce as unreliable", () => {
    const res = reconcileOutreachBatch(
      [row({ status: "sent", sent_at: new Date() })],
      [{ id: "or_1", bounced_at: "2026-06-23T11:00:00.000Z" }]
    )
    expect(res.items[0].patch.status).toBe("bounced")
    expect(res.items[0].patch.bounce_unreliable).toBe(true)
  })
})

describe("selectSyncableOutreach", () => {
  it("keeps non-terminal rows with an external_id", () => {
    const rows = [
      row({ id: "a", status: "sent", external_id: "m_a" }),
      row({ id: "b", status: "queued", external_id: "m_b" }),
    ]
    expect(selectSyncableOutreach(rows).map((r) => r.id)).toEqual(["a", "b"])
  })

  it("drops rows without an external_id and already-replied rows", () => {
    const rows = [
      row({ id: "no_ext", external_id: null }),
      row({ id: "blank_ext", external_id: "   " }),
      row({ id: "replied", status: "replied", external_id: "m_r" }),
    ]
    expect(selectSyncableOutreach(rows)).toHaveLength(0)
  })
})

describe("summarizeOutreachSync", () => {
  it("flags an unconfigured provider", () => {
    expect(
      summarizeOutreachSync({
        dry_run: true,
        eventsReceived: 0,
        matchedRows: 0,
        changedRows: 0,
        totalChanges: 0,
        providerConfigured: false,
      })
    ).toMatch(/not configured/i)
  })

  it("reports a no-op when nothing changed", () => {
    expect(
      summarizeOutreachSync({
        dry_run: true,
        eventsReceived: 3,
        matchedRows: 2,
        changedRows: 0,
        totalChanges: 0,
      })
    ).toMatch(/No engagement changes/i)
  })

  it("distinguishes dry-run preview from applied", () => {
    expect(
      summarizeOutreachSync({
        dry_run: true,
        eventsReceived: 2,
        matchedRows: 2,
        changedRows: 2,
        totalChanges: 4,
      })
    ).toMatch(/Would update/i)
    expect(
      summarizeOutreachSync({
        dry_run: false,
        eventsReceived: 2,
        matchedRows: 2,
        changedRows: 2,
        totalChanges: 4,
      })
    ).toMatch(/^Updated/i)
  })
})

import {
  classifyEngagement,
  isBulkSuppressed,
} from "../classifier"
import { selectNewsletterWinbackTargets } from "../winback-select"

const NOW = new Date("2026-07-06T00:00:00.000Z")
const daysAgo = (d: number) =>
  new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString()

describe("classifier — classifyEngagement", () => {
  it("unknown when too little data (< minDataDelivered)", () => {
    expect(classifyEngagement({ delivered_count: 2, opens_count: 0 }, { now: NOW }).status).toBe("unknown")
  })

  it("engaged when recently opened (short cold streak)", () => {
    const c = classifyEngagement(
      { delivered_count: 10, opens_count: 4, delivered_since_last_open: 1, first_delivered_at: daysAgo(120) },
      { now: NOW }
    )
    expect(c.status).toBe("engaged")
    expect(c.bulk_suppressed).toBe(false)
  })

  it("cooling when an ever-engaged contact hits the cooling streak but not dormant", () => {
    const c = classifyEngagement(
      { delivered_count: 10, opens_count: 2, delivered_since_last_open: 3, first_delivered_at: daysAgo(120) },
      { now: NOW }
    )
    expect(c.status).toBe("cooling")
    expect(c.bulk_suppressed).toBe(false)
  })

  it("dormant when an ever-engaged contact goes cold past the streak over enough time", () => {
    const c = classifyEngagement(
      { delivered_count: 12, opens_count: 2, delivered_since_last_open: 5, first_delivered_at: daysAgo(120) },
      { now: NOW }
    )
    expect(c.status).toBe("dormant")
    expect(c.bulk_suppressed).toBe(true)
  })

  it("NOT dormant if the cold streak is old enough but the account is too young (span < 30d)", () => {
    const c = classifyEngagement(
      { delivered_count: 12, opens_count: 2, delivered_since_last_open: 6, first_delivered_at: daysAgo(10) },
      { now: NOW }
    )
    expect(c.status).toBe("cooling") // flagged, but not suppressed
    expect(c.bulk_suppressed).toBe(false)
  })

  it("never_opened when opens=0 but not yet enough deliveries/time for dormant", () => {
    const c = classifyEngagement(
      { delivered_count: 4, opens_count: 0, delivered_since_last_open: 4, first_delivered_at: daysAgo(120) },
      { now: NOW }
    )
    expect(c.status).toBe("never_opened")
    expect(c.bulk_suppressed).toBe(false)
  })

  it("dormant when opens=0 with enough deliveries over enough time", () => {
    const c = classifyEngagement(
      { delivered_count: 6, opens_count: 0, delivered_since_last_open: 6, first_delivered_at: daysAgo(120) },
      { now: NOW }
    )
    expect(c.status).toBe("dormant")
  })

  it("only dormant is bulk-suppressed", () => {
    expect(isBulkSuppressed("dormant")).toBe(true)
    expect(isBulkSuppressed("cooling")).toBe(false)
    expect(isBulkSuppressed("never_opened")).toBe(false)
    expect(isBulkSuppressed("engaged")).toBe(false)
    expect(isBulkSuppressed("unknown")).toBe(false)
  })
})

describe("winback-select — selectNewsletterWinbackTargets", () => {
  const cooling = (email: string, cold: number) => ({
    email,
    delivered_count: 10,
    opens_count: 2,
    delivered_since_last_open: cold,
    first_delivered_at: daysAgo(120),
    last_open_at: daysAgo(60),
    last_delivered_at: daysAgo(1),
  })

  it("selects only cooling contacts, coldest first, and skips already-targeted", () => {
    const rows = [
      cooling("a@x.com", 3),
      cooling("b@x.com", 4),
      { ...cooling("c@x.com", 5) }, // dormant (streak 5) — excluded
      { email: "d@x.com", delivered_count: 10, opens_count: 5, delivered_since_last_open: 1, first_delivered_at: daysAgo(120) }, // engaged
    ]
    const sel = selectNewsletterWinbackTargets(rows, new Set(["a@x.com"]), { now: NOW })
    expect(sel.targets.map((t) => t.email)).toEqual(["b@x.com"]) // a skipped (already), coldest-first
    expect(sel.stats.cooling).toBe(2) // a + b classified cooling
    expect(sel.stats.skipped_already).toBe(1)
  })

  it("caps the target list and reports the overflow", () => {
    const rows = [cooling("a@x.com", 4), cooling("b@x.com", 3), cooling("c@x.com", 3)]
    const sel = selectNewsletterWinbackTargets(rows, new Set(), { now: NOW, cap: 2 })
    expect(sel.targets).toHaveLength(2)
    expect(sel.stats.capped).toBe(1)
    expect(sel.targets[0].email).toBe("a@x.com") // coldest first
  })

  it("skips cooling rows with no email", () => {
    const sel = selectNewsletterWinbackTargets([cooling("", 4)], new Set(), { now: NOW })
    expect(sel.targets).toHaveLength(0)
    expect(sel.stats.skipped_no_email).toBe(1)
  })
})

/**
 * Unit test — compute-snapshot (#659 slice 3, PR-3a)
 *
 * Pure metric-row math for the marketing daily-refresh job. No DI, no DB.
 *
 * Run:
 *   TEST_TYPE=unit npx jest --testPathPattern="compute-snapshot"
 */
import {
  computeSnapshotRows,
  istDayStart,
  priorValueFor,
  type MarketingMetricInput,
  type PriorSnapshotRow,
} from "../compute-snapshot"

describe("istDayStart", () => {
  it("maps an afternoon-UTC instant to IST midnight of the SAME IST day", () => {
    // 2026-06-23T10:00:00Z = 15:30 IST on 2026-06-23 → IST midnight = 2026-06-22T18:30:00Z
    const out = istDayStart(new Date("2026-06-23T10:00:00Z"))
    expect(out.toISOString()).toBe("2026-06-22T18:30:00.000Z")
  })

  it("rolls into the next IST day once UTC passes 18:30", () => {
    // 2026-06-23T19:00:00Z = 00:30 IST on 2026-06-24 → IST midnight = 2026-06-23T18:30:00Z
    const out = istDayStart(new Date("2026-06-23T19:00:00Z"))
    expect(out.toISOString()).toBe("2026-06-23T18:30:00.000Z")
  })

  it("is idempotent — feeding its own output back yields the same instant", () => {
    const once = istDayStart(new Date("2026-06-23T10:00:00Z"))
    expect(istDayStart(once).toISOString()).toBe(once.toISOString())
  })
})

describe("priorValueFor", () => {
  const rows: PriorSnapshotRow[] = [
    { metric_key: "platform_net_gmv", value: 100, captured_for_date: "2026-06-20T18:30:00Z" },
    { metric_key: "platform_net_gmv", value: 140, captured_for_date: "2026-06-21T18:30:00Z" },
    { metric_key: "partners_activated", value: 7, captured_for_date: "2026-06-21T18:30:00Z" },
  ]
  const asOfMs = new Date("2026-06-22T18:30:00Z").getTime()

  it("returns the latest prior value strictly before asOf for the metric", () => {
    expect(priorValueFor("platform_net_gmv", asOfMs, rows)).toBe(140)
  })

  it("isolates per metric_key", () => {
    expect(priorValueFor("partners_activated", asOfMs, rows)).toBe(7)
  })

  it("ignores rows on/after asOf (same-day re-run is not 'prior')", () => {
    const sameDay: PriorSnapshotRow[] = [
      { metric_key: "x", value: 5, captured_for_date: "2026-06-22T18:30:00Z" },
    ]
    expect(priorValueFor("x", asOfMs, sameDay)).toBeNull()
  })

  it("returns null with no history / no matching metric", () => {
    expect(priorValueFor("missing", asOfMs, rows)).toBeNull()
    expect(priorValueFor("x", asOfMs, [])).toBeNull()
    expect(priorValueFor("x", asOfMs, null)).toBeNull()
  })

  it("tolerates a gap — picks the latest available prior, not exactly yesterday", () => {
    const gappy: PriorSnapshotRow[] = [
      { metric_key: "g", value: 10, captured_for_date: "2026-06-18T18:30:00Z" },
    ]
    expect(priorValueFor("g", asOfMs, gappy)).toBe(10)
  })
})

describe("computeSnapshotRows", () => {
  const asOf = new Date("2026-06-23T10:00:00Z") // → IST day 2026-06-22T18:30:00Z
  const capturedISO = "2026-06-22T18:30:00.000Z"

  const inputs: MarketingMetricInput[] = [
    { metric_key: "platform_net_gmv", value: 1500, unit: "INR" },
    { metric_key: "partners_activated", value: 9, unit: "count" },
    { metric_key: "storefront_conversion_rate", value: 0.0312, unit: "ratio" },
  ]

  it("short-circuits to [] for empty / nullish inputs (zero-activity day)", () => {
    const cases: Array<MarketingMetricInput[] | null | undefined> = [[], null, undefined]
    for (const i of cases) {
      expect(computeSnapshotRows(i, asOf)).toEqual([])
    }
  })

  it("normalises captured_for_date to IST midnight for every row", () => {
    const rows = computeSnapshotRows(inputs, asOf)
    expect(rows).toHaveLength(3)
    for (const r of rows) {
      expect(r.captured_for_date.toISOString()).toBe(capturedISO)
      expect(r.source).toBe("daily-refresh")
    }
  })

  it("reports delta_dod = null when there is no prior history", () => {
    const rows = computeSnapshotRows(inputs, asOf)
    expect(rows.every((r) => r.delta_dod === null)).toBe(true)
  })

  it("computes delta_dod against the latest prior row per metric", () => {
    const prior: PriorSnapshotRow[] = [
      { metric_key: "platform_net_gmv", value: 1000, captured_for_date: "2026-06-21T18:30:00Z" },
      { metric_key: "partners_activated", value: 12, captured_for_date: "2026-06-21T18:30:00Z" },
    ]
    const rows = computeSnapshotRows(inputs, asOf, prior)
    const gmv = rows.find((r) => r.metric_key === "platform_net_gmv")!
    const partners = rows.find((r) => r.metric_key === "partners_activated")!
    const conv = rows.find((r) => r.metric_key === "storefront_conversion_rate")!
    expect(gmv.delta_dod).toBe(500) // 1500 - 1000
    expect(partners.delta_dod).toBe(-3) // 9 - 12 (declines are negative)
    expect(conv.delta_dod).toBeNull() // no prior for this metric
  })

  it("rounds delta to 2dp to avoid float drift on ratios", () => {
    const rows = computeSnapshotRows(
      [{ metric_key: "r", value: 0.3, unit: "ratio" }],
      asOf,
      [{ metric_key: "r", value: 0.1, captured_for_date: "2026-06-21T18:30:00Z" }]
    )
    expect(rows[0].delta_dod).toBe(0.2) // not 0.19999999999999998
  })

  it("passes through unit + breakdown and defaults nulls", () => {
    const rows = computeSnapshotRows(
      [
        {
          metric_key: "platform_net_gmv",
          value: 100,
          unit: "INR",
          breakdown: [{ label: "IN", value: 80 }],
        },
        { metric_key: "bare", value: 1 },
      ],
      asOf
    )
    expect(rows[0].breakdown).toEqual([{ label: "IN", value: 80 }])
    expect(rows[0].unit).toBe("INR")
    expect(rows[1].breakdown).toBeNull()
    expect(rows[1].unit).toBeNull()
  })

  it("honours an explicit source override (manual / backfill)", () => {
    const rows = computeSnapshotRows(inputs, asOf, null, { source: "backfill" })
    expect(rows.every((r) => r.source === "backfill")).toBe(true)
  })
})

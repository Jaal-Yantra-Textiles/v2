import {
  HEADLINE_METRIC_KEY,
  HEADLINE_STALE_AFTER_DAYS,
  MAX_SNAPSHOTS_LIMIT,
  DEFAULT_SNAPSHOTS_LIMIT,
  parseNonNegativeInt,
  parseSnapshotQuery,
  sortSnapshotsNewestFirst,
  latestPerMetricKey,
  buildHeadlineResponse,
  snapshotEpoch,
  SnapshotRow,
} from "../marketing-read-lib"

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date("2026-06-23T12:00:00.000Z")

function row(
  metric_key: string,
  value: number,
  daysAgo: number,
  extra: Partial<SnapshotRow> = {}
): SnapshotRow {
  return {
    metric_key,
    value,
    captured_for_date: new Date(NOW.getTime() - daysAgo * DAY),
    ...extra,
  }
}

describe("parseNonNegativeInt", () => {
  it("returns fallback on missing/blank/invalid/negative", () => {
    expect(parseNonNegativeInt(undefined, 7)).toBe(7)
    expect(parseNonNegativeInt("", 7)).toBe(7)
    expect(parseNonNegativeInt("abc", 7)).toBe(7)
    expect(parseNonNegativeInt("-3", 7)).toBe(7)
  })
  it("parses valid ints and array-form query values", () => {
    expect(parseNonNegativeInt("12", 0)).toBe(12)
    expect(parseNonNegativeInt(["5", "9"], 0)).toBe(5)
    expect(parseNonNegativeInt("0", 7)).toBe(0)
  })
})

describe("parseSnapshotQuery", () => {
  it("defaults limit/offset and omits filters when query is empty", () => {
    const q = parseSnapshotQuery({}, NOW)
    expect(q.metric_key).toBeUndefined()
    expect(q.startDate).toBeUndefined()
    expect(q.endDate).toBeUndefined()
    expect(q.limit).toBe(DEFAULT_SNAPSHOTS_LIMIT)
    expect(q.offset).toBe(0)
  })

  it("derives a rolling window from days (takes precedence over explicit dates)", () => {
    const q = parseSnapshotQuery(
      { days: "7", start_date: "2000-01-01" },
      NOW
    )
    expect(q.endDate).toEqual(NOW)
    expect(q.startDate).toEqual(new Date(NOW.getTime() - 7 * DAY))
  })

  it("uses explicit start_date/end_date when no days", () => {
    const q = parseSnapshotQuery(
      { start_date: "2026-06-01T00:00:00.000Z", end_date: "2026-06-10T00:00:00.000Z" },
      NOW
    )
    expect(q.startDate).toEqual(new Date("2026-06-01T00:00:00.000Z"))
    expect(q.endDate).toEqual(new Date("2026-06-10T00:00:00.000Z"))
  })

  it("ignores invalid dates and non-positive days", () => {
    const q = parseSnapshotQuery(
      { days: "0", start_date: "not-a-date" },
      NOW
    )
    expect(q.startDate).toBeUndefined()
    expect(q.endDate).toBeUndefined()
  })

  it("caps limit at MAX and passes metric_key through", () => {
    const q = parseSnapshotQuery({ metric_key: "platform_net_gmv", limit: "99999" }, NOW)
    expect(q.metric_key).toBe("platform_net_gmv")
    expect(q.limit).toBe(MAX_SNAPSHOTS_LIMIT)
  })
})

describe("snapshotEpoch + sortSnapshotsNewestFirst", () => {
  it("accepts both Date and ISO-string captured_for_date", () => {
    expect(snapshotEpoch(row("a", 1, 0))).toBe(NOW.getTime())
    expect(
      snapshotEpoch({ metric_key: "a", value: 1, captured_for_date: NOW.toISOString() })
    ).toBe(NOW.getTime())
  })
  it("orders newest first without mutating input", () => {
    const input = [row("a", 1, 3), row("a", 2, 0), row("a", 3, 1)]
    const sorted = sortSnapshotsNewestFirst(input)
    expect(sorted.map((r) => r.value)).toEqual([2, 3, 1])
    expect(input.map((r) => r.value)).toEqual([1, 2, 3]) // untouched
  })
})

describe("latestPerMetricKey", () => {
  it("keeps the newest row per metric regardless of input order", () => {
    const map = latestPerMetricKey([
      row("gmv", 10, 2),
      row("gmv", 30, 0),
      row("gmv", 20, 1),
      row("orders", 5, 1),
    ])
    expect(map.get("gmv")!.value).toBe(30)
    expect(map.get("orders")!.value).toBe(5)
    expect(map.size).toBe(2)
  })
})

describe("buildHeadlineResponse", () => {
  it("returns empty/stale state on no data", () => {
    const out = buildHeadlineResponse([], HEADLINE_METRIC_KEY, NOW)
    expect(out.headline).toBeNull()
    expect(out.strip).toEqual([])
    expect(out.trend).toEqual([])
    expect(out.stale).toBe(true)
    expect(out.generated_at).toBe(NOW.toISOString())
  })

  it("picks the newest headline row, fills dod_delta/unit, and is fresh within window", () => {
    const rows = [
      row(HEADLINE_METRIC_KEY, 100, 1, { delta_dod: 4.2, unit: "INR" }),
      row(HEADLINE_METRIC_KEY, 200, 0, { delta_dod: -1.5, unit: "INR" }),
      row("orders_count", 12, 0, { unit: "count" }),
    ]
    const out = buildHeadlineResponse(rows, HEADLINE_METRIC_KEY, NOW)
    expect(out.headline).toEqual({
      metric_key: HEADLINE_METRIC_KEY,
      value: 200,
      unit: "INR",
      dod_delta: -1.5,
      as_of_date: new Date(NOW.getTime()).toISOString(),
    })
    expect(out.stale).toBe(false)
  })

  it("puts other metrics in the strip (sorted, excluding the headline metric)", () => {
    const rows = [
      row(HEADLINE_METRIC_KEY, 200, 0),
      row("orders_count", 12, 0, { unit: "count" }),
      row("storefront_sessions", 999, 0),
    ]
    const out = buildHeadlineResponse(rows, HEADLINE_METRIC_KEY, NOW)
    expect(out.strip.map((s) => s.metric_key)).toEqual([
      "orders_count",
      "storefront_sessions",
    ])
    expect(out.headline!.metric_key).toBe(HEADLINE_METRIC_KEY)
  })

  it("emits the trend oldest→newest for the headline metric only", () => {
    const rows = [
      row(HEADLINE_METRIC_KEY, 100, 2),
      row(HEADLINE_METRIC_KEY, 300, 0),
      row(HEADLINE_METRIC_KEY, 200, 1),
      row("orders_count", 9, 0),
    ]
    const out = buildHeadlineResponse(rows, HEADLINE_METRIC_KEY, NOW)
    expect(out.trend.map((t) => t.value)).toEqual([100, 200, 300])
  })

  it("flags stale when the freshest headline day is older than the threshold", () => {
    const rows = [row(HEADLINE_METRIC_KEY, 50, HEADLINE_STALE_AFTER_DAYS + 1)]
    const out = buildHeadlineResponse(rows, HEADLINE_METRIC_KEY, NOW)
    expect(out.headline!.value).toBe(50)
    expect(out.stale).toBe(true)
  })

  it("respects a custom metric key", () => {
    const rows = [
      row("partners_activated", 7, 0),
      row(HEADLINE_METRIC_KEY, 200, 0),
    ]
    const out = buildHeadlineResponse(rows, "partners_activated", NOW)
    expect(out.headline!.metric_key).toBe("partners_activated")
    expect(out.strip.map((s) => s.metric_key)).toEqual([HEADLINE_METRIC_KEY])
  })
})

import {
  buildDailyMarketingSummary,
  formatSummaryValue,
  formatDelta,
  humanizeMetricKey,
} from "../marketing-summary-lib"
import type { HeadlineResponse } from "../marketing-read-lib"

/**
 * #659 §12.6 — unit tests for the pure WhatsApp daily-summary composer.
 */

describe("formatSummaryValue", () => {
  it("formats by unit", () => {
    expect(formatSummaryValue(123456, "inr")).toBe("₹1,23,456")
    expect(formatSummaryValue(1234, "usd")).toBe("$1,234")
    expect(formatSummaryValue(3.45, "percent")).toBe("3.5%")
    expect(formatSummaryValue(0.034, "ratio")).toBe("3.4%")
    expect(formatSummaryValue(12, "count")).toBe("12")
    expect(formatSummaryValue(7)).toBe("7")
  })
})

describe("formatDelta", () => {
  it("renders up/down/flat and blanks on null", () => {
    expect(formatDelta(4.2)).toBe(" (▲ +4.2% DoD)")
    expect(formatDelta(-1)).toBe(" (▼ -1% DoD)")
    expect(formatDelta(0)).toBe(" (▬ 0% DoD)")
    expect(formatDelta(null)).toBe("")
    expect(formatDelta(undefined)).toBe("")
  })
})

describe("humanizeMetricKey", () => {
  it("title-cases snake keys", () => {
    expect(humanizeMetricKey("platform_net_gmv")).toBe("Platform Net Gmv")
    expect(humanizeMetricKey("")).toBe("")
  })
})

const resp = (over: Partial<HeadlineResponse> = {}): HeadlineResponse => ({
  headline: {
    metric_key: "platform_net_gmv",
    value: 123456,
    unit: "inr",
    dod_delta: 4.2,
    as_of_date: "2026-06-23T00:00:00.000Z",
  },
  strip: [
    {
      metric_key: "partner_activations",
      value: 12,
      unit: "count",
      dod_delta: -1,
      as_of_date: "2026-06-23T00:00:00.000Z",
    },
  ],
  trend: [],
  stale: false,
  generated_at: "2026-06-23T10:00:00.000Z",
  ...over,
})

describe("buildDailyMarketingSummary", () => {
  it("composes headline + strip with a date title", () => {
    const out = buildDailyMarketingSummary(resp(), { dateLabel: "2026-06-23" })
    expect(out.hasData).toBe(true)
    expect(out.stale).toBe(false)
    expect(out.text).toContain("📊 JYT Marketing — 2026-06-23")
    expect(out.text).toContain("🎯 Platform Net Gmv: ₹1,23,456 (▲ +4.2% DoD)")
    expect(out.text).toContain("Other metrics:")
    expect(out.text).toContain("• Partner Activations: 12 (▼ -1% DoD)")
    expect(out.text).not.toContain("stale")
  })

  it("appends a staleness warning", () => {
    const out = buildDailyMarketingSummary(resp({ stale: true }), {
      dateLabel: "2026-06-23",
    })
    expect(out.stale).toBe(true)
    expect(out.text).toContain("⚠️")
    expect(out.text).toContain("stale")
  })

  it("uses a custom business name", () => {
    const out = buildDailyMarketingSummary(resp(), {
      dateLabel: "2026-06-23",
      businessName: "ACME",
    })
    expect(out.text).toContain("📊 ACME Marketing")
  })

  it("reports no data when there is no headline and no strip", () => {
    const out = buildDailyMarketingSummary(
      resp({ headline: null, strip: [] }),
      { dateLabel: "2026-06-23" }
    )
    expect(out.hasData).toBe(false)
    expect(out.text).toContain("No metrics captured yet")
  })

  it("handles a missing headline but present strip", () => {
    const out = buildDailyMarketingSummary(resp({ headline: null }), {
      dateLabel: "2026-06-23",
    })
    expect(out.hasData).toBe(true)
    expect(out.text).toContain("One-Goal metric not captured yet")
    expect(out.text).toContain("Partner Activations")
  })
})

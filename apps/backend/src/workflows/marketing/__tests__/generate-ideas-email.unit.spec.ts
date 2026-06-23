import {
  buildGroundTruthFromSnapshots,
  formatMetricDisplay,
} from "../generate-ideas-email"

/**
 * #659 slice 2, PR-2 — unit tests for the PURE pieces of generate-ideas-email
 * (no container, no LLM): the display formatter and the snapshot→GroundTruth
 * mapping (token derivation, latest-per-metric dedup, delta_dod sub-token).
 */
describe("formatMetricDisplay", () => {
  it("formats INR / USD as integer currency", () => {
    expect(formatMetricDisplay(184320, "INR")).toBe("₹1,84,320")
    expect(formatMetricDisplay(2500.9, "USD")).toBe("$2,501")
  })
  it("formats ratio as a percent and percent as-is", () => {
    expect(formatMetricDisplay(0.034, "ratio")).toBe("3.4%")
    expect(formatMetricDisplay(12.5, "percent")).toBe("12.5%")
  })
  it("formats count with grouping and falls back to String", () => {
    expect(formatMetricDisplay(1200, "count")).toBe("1,200")
    expect(formatMetricDisplay(7, null)).toBe("7")
  })
})

describe("buildGroundTruthFromSnapshots", () => {
  const opts = { dateIst: "2026-06-23", one_goal: "x" } as any
  const base = { dateIst: "2026-06-23", oneGoal: "Grow GMV." }

  it("maps metric_key → {TOKEN} and adds a delta_dod sub-token", () => {
    const gt = buildGroundTruthFromSnapshots(
      [
        {
          metric_key: "platform_gmv",
          value: 1000,
          unit: "INR",
          captured_for_date: "2026-06-23",
          delta_dod: 4.5,
        },
      ],
      base
    )
    const tokens = gt.values.map((v) => v.token)
    expect(tokens).toContain("PLATFORM_GMV")
    expect(tokens).toContain("PLATFORM_GMV_DELTA_DOD")
    expect(gt.one_goal).toBe("Grow GMV.")
    expect(gt.date_ist).toBe("2026-06-23")
    const delta = gt.values.find((v) => v.token === "PLATFORM_GMV_DELTA_DOD")!
    expect(delta.display).toBe("+4.5%")
  })

  it("omits the delta sub-token when delta_dod is null/undefined", () => {
    const gt = buildGroundTruthFromSnapshots(
      [
        {
          metric_key: "partner_activations",
          value: 12,
          unit: "count",
          captured_for_date: "2026-06-23",
          delta_dod: null,
        },
      ],
      base
    )
    expect(gt.values.map((v) => v.token)).toEqual(["PARTNER_ACTIVATIONS"])
  })

  it("keeps only the latest (first) row per metric_key", () => {
    const gt = buildGroundTruthFromSnapshots(
      [
        { metric_key: "gmv", value: 999, captured_for_date: "2026-06-23" },
        { metric_key: "gmv", value: 111, captured_for_date: "2026-06-22" },
      ],
      base
    )
    const gmv = gt.values.filter((v) => v.token === "GMV")
    expect(gmv).toHaveLength(1)
    expect(gmv[0].value).toBe(999)
    void opts
  })

  it("formats negative delta with a leading minus", () => {
    const gt = buildGroundTruthFromSnapshots(
      [{ metric_key: "gmv", value: 1, captured_for_date: "x", delta_dod: -3.21 }],
      base
    )
    const delta = gt.values.find((v) => v.token === "GMV_DELTA_DOD")!
    expect(delta.display).toBe("-3.2%")
  })
})

/**
 * Unit tests for the `partner_analytics_digest` operation's pure helpers
 * (#581 S3). The orchestration in `execute` resolves the container + runs the
 * S1 workflow per partner, which isn't headless-testable; the selection and
 * summary logic IS pure, so we assert it directly without booting Medusa.
 */

import {
  selectDigestPartnerIds,
  summarizeDigestRun,
  partnerAnalyticsDigestOperation,
  partnerAnalyticsDigestOptionsSchema,
} from "../partner-analytics-digest"

describe("selectDigestPartnerIds", () => {
  it("uses an explicit single partner_id", () => {
    expect(
      selectDigestPartnerIds({ partnerId: "p_1", listedPartnerIds: ["p_9"] })
    ).toEqual(["p_1"])
  })

  it("uses an explicit partner_ids array (ignores listed)", () => {
    expect(
      selectDigestPartnerIds({
        partnerIds: ["p_1", "p_2"],
        listedPartnerIds: ["p_9"],
      })
    ).toEqual(["p_1", "p_2"])
  })

  it("merges partner_id + partner_ids when both supplied", () => {
    expect(
      selectDigestPartnerIds({ partnerId: "p_1", partnerIds: ["p_2", "p_3"] })
    ).toEqual(["p_1", "p_2", "p_3"])
  })

  it("accepts partner_ids as a single string", () => {
    expect(selectDigestPartnerIds({ partnerIds: "p_5" })).toEqual(["p_5"])
  })

  it("falls back to listed partners when no explicit selection", () => {
    expect(
      selectDigestPartnerIds({ listedPartnerIds: ["p_a", "p_b"] })
    ).toEqual(["p_a", "p_b"])
  })

  it("de-dupes preserving first-seen order", () => {
    expect(
      selectDigestPartnerIds({
        partnerId: "p_1",
        partnerIds: ["p_1", "p_2", "p_2", "p_3"],
      })
    ).toEqual(["p_1", "p_2", "p_3"])
  })

  it("trims whitespace and drops empty entries", () => {
    expect(
      selectDigestPartnerIds({
        partnerId: "  p_1  ",
        partnerIds: ["", "  ", "p_2 "],
      })
    ).toEqual(["p_1", "p_2"])
  })

  it("caps to maxPartners", () => {
    expect(
      selectDigestPartnerIds({
        listedPartnerIds: ["a", "b", "c", "d"],
        maxPartners: 2,
      })
    ).toEqual(["a", "b"])
  })

  it("returns [] when nothing is selectable", () => {
    expect(selectDigestPartnerIds({})).toEqual([])
    expect(
      selectDigestPartnerIds({ listedPartnerIds: ["", null as any] })
    ).toEqual([])
  })

  it("ignores non-string entries in partner_ids", () => {
    expect(
      selectDigestPartnerIds({
        partnerIds: ["p_1", 42 as any, null as any, "p_2"],
      })
    ).toEqual(["p_1", "p_2"])
  })

  it("defaults maxPartners sanely when invalid", () => {
    const ids = Array.from({ length: 250 }, (_, i) => `p_${i}`)
    expect(
      selectDigestPartnerIds({ listedPartnerIds: ids, maxPartners: 0 }).length
    ).toBe(200)
  })
})

describe("summarizeDigestRun", () => {
  const digest = (overrides: any = {}) => ({
    partner_id: "p",
    website: { id: "web_1" },
    period: {} as any,
    kpis: {} as any,
    breakdowns: {} as any,
    not_found_count: 0,
    suggestions: [],
    ...overrides,
  })

  it("counts empty as all zero", () => {
    expect(summarizeDigestRun([])).toEqual({
      count: 0,
      with_storefront: 0,
      with_suggestions: 0,
      suggestion_count: 0,
    })
  })

  it("tallies storefronts, suggestion-bearing partners, and total suggestions", () => {
    const out = summarizeDigestRun([
      digest({ website: { id: "w1" }, suggestions: [{}, {}] }),
      digest({ website: null, suggestions: [] }),
      digest({ website: { id: "w3" }, suggestions: [{}] }),
    ] as any)
    expect(out).toEqual({
      count: 3,
      with_storefront: 2,
      with_suggestions: 2,
      suggestion_count: 3,
    })
  })

  it("treats a missing suggestions array as zero", () => {
    const out = summarizeDigestRun([
      digest({ suggestions: undefined }),
    ] as any)
    expect(out.with_suggestions).toBe(0)
    expect(out.suggestion_count).toBe(0)
  })
})

describe("partnerAnalyticsDigestOperation definition", () => {
  it("registers under a stable type with a default options schema", () => {
    expect(partnerAnalyticsDigestOperation.type).toBe("partner_analytics_digest")
    expect(partnerAnalyticsDigestOperation.category).toBe("data")
    // schema parses an empty object via defaults
    const parsed = partnerAnalyticsDigestOptionsSchema.parse({})
    expect(parsed.max_partners).toBe(200)
    expect(parsed.continue_on_error).toBe(true)
  })

  it("accepts a named period and a {days} period", () => {
    expect(
      partnerAnalyticsDigestOptionsSchema.parse({ period: "last_30_days" })
        .period
    ).toBe("last_30_days")
    expect(
      partnerAnalyticsDigestOptionsSchema.parse({ period: { days: 14 } }).period
    ).toEqual({ days: 14 })
  })
})

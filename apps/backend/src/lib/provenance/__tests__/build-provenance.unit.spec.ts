import { buildProvenance, type ProvenanceFacts } from "../build-provenance"

/**
 * The provenance shaper. Page and email render the same `rows[]`, so these
 * tests are the only place the shape is decided.
 *
 * The boundary that matters most here is what is NOT in it: a business buyer
 * sees this, and commercial terms must never leak into a buyer-facing surface.
 */

const facts = (over: ProvenanceFacts = {}): ProvenanceFacts => ({
  partner: {
    name: "Unique Pashmina",
    handle: "unique-pashmina",
    country_code: "IN",
    is_verified: true,
  },
  onboarding_profile: {
    what_they_sell: "home_textiles",
    person_type: "artisan",
    team_size: 12,
    does_weaving: true,
  },
  artisan_detail: {
    maker_story: "Woven on pit looms in the Kashmir valley.",
    lead_time_days: 21,
    min_order_quantity: 50,
    made_to_order: true,
  },
  ...over,
})

const keys = (f: ProvenanceFacts) => buildProvenance(f).rows.map((r) => r.key)

describe("buildProvenance", () => {
  it("shapes partner, profile and product facts into one row list", () => {
    const res = buildProvenance(facts())

    expect(res.maker_name).toBe("Unique Pashmina")
    expect(res.maker_story).toBe("Woven on pit looms in the Kashmir valley.")
    expect(keys(facts())).toEqual([
      "maker",
      "country",
      "verified",
      "maker_type",
      "specialises_in",
      "team_size",
      "weaving",
      "made_to_order",
      "lead_time",
      "min_order_quantity",
    ])
  })

  it("attributes every row to the record it came from", () => {
    // An unattributed fact is a claim.
    const rows = buildProvenance(facts()).rows
    expect(rows.every((r) => r.source)).toBe(true)
    expect(rows.find((r) => r.key === "team_size")?.source).toBe(
      "partner-onboarding-profile"
    )
    expect(rows.find((r) => r.key === "lead_time")?.source).toBe(
      "artisan-product-detail"
    )
  })

  it("omits a row entirely rather than rendering an empty one", () => {
    // "We know this and it is nothing" is a different, wrong claim.
    const res = buildProvenance({ partner: { name: "Solo Weaver" } })

    expect(res.rows).toHaveLength(1)
    expect(res.maker_story).toBeNull()
  })

  it("never states verification when it is false", () => {
    // "Verified: no" is an accusation, not a fact.
    expect(
      keys(facts({ partner: { name: "X", is_verified: false } }))
    ).not.toContain("verified")
  })

  it("prefers the partner's own lead-time words over the day count", () => {
    const res = buildProvenance(
      facts({
        artisan_detail: { lead_time_days: 21, lead_time_label: "3–4 weeks" },
      })
    )

    expect(res.rows.find((r) => r.key === "lead_time")?.value).toBe("3–4 weeks")
  })

  it("suppresses a minimum order of 1", () => {
    expect(
      keys(facts({ artisan_detail: { min_order_quantity: 1 } }))
    ).not.toContain("min_order_quantity")
  })

  it("names a known country and passes an unknown code through unchanged", () => {
    const known = buildProvenance(facts({ partner: { country_code: "IN" } }))
    expect(known.rows.find((r) => r.key === "country")?.value).toBe("India")

    // Honest beats guessed.
    const unknown = buildProvenance(facts({ partner: { country_code: "np" } }))
    expect(unknown.rows.find((r) => r.key === "country")?.value).toBe("NP")
  })

  it("singularises a one-person team and a one-day lead time", () => {
    const res = buildProvenance(
      facts({
        onboarding_profile: { team_size: 1 },
        artisan_detail: { lead_time_days: 1 },
      })
    )

    expect(res.rows.find((r) => r.key === "team_size")?.value).toBe("1 person")
    expect(res.rows.find((r) => r.key === "lead_time")?.value).toBe("1 day")
  })

  it("LEAKS NO commercial terms to a business buyer", () => {
    // The hard boundary. Adding a field to the shaper publishes it.
    const res = buildProvenance({
      ...facts(),
      onboarding_profile: {
        ...(facts().onboarding_profile as any),
        // Fields that exist on the profile and must never surface here.
        commission_bps: 1500,
        payment_collection: "through_us",
        selling_mode: "core_channel_listing",
        supplies_to_platform: true,
        price_range: "luxury",
      } as any,
    })

    const serialized = JSON.stringify(res)
    expect(serialized).not.toContain("1500")
    expect(serialized).not.toContain("through_us")
    expect(serialized).not.toContain("core_channel_listing")
    expect(serialized).not.toContain("luxury")
  })

  it("survives being handed nothing at all", () => {
    const res = buildProvenance({})

    expect(res.rows).toEqual([])
    expect(res.maker_name).toBeNull()
    expect(res.maker_story).toBeNull()
  })
})

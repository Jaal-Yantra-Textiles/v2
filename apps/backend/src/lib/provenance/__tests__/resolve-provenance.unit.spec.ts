import {
  consensusArtisanDetail,
  hasProvenance,
  resolveQuoteProvenance,
} from "../resolve-provenance"

/**
 * The half of provenance that reads the database (#1439 S9).
 *
 * `build-provenance.ts` decides WHAT a buyer sees and has its own suite. These
 * tests are about the two things this file can get wrong and the shaper cannot:
 *
 * 1. **Misattribution across a basket.** A quote can mix a made-to-order shawl
 *    with a stocked scarf. Printing the shawl's lead time over the whole quote
 *    is a claim about an item it was never made about — so the assertion that
 *    matters is that a MIXED basket loses those rows entirely rather than
 *    taking the first line's.
 * 2. **Failing loud.** Provenance is a credit line; every failure must collapse
 *    to `null`, never to a 500 on the buyer's page.
 */

const PARTNER = {
  id: "part_1",
  name: "Unique Pashmina",
  handle: "unique-pashmina",
  country_code: "IN",
  is_verified: true,
  workspace_type: "artisan",
  status: "active",
}

const PROFILE = {
  what_they_sell: "home_textiles",
  person_type: "artisan",
  team_size: 12,
  does_weaving: true,
  // Commercial fields are present on the ROW and must not reach the buyer.
  commission_bps: 1500,
  price_range: "luxury",
  payment_collection: "through_us",
  selling_mode: "core_channel_listing",
}

const DETAIL_A = {
  maker_story: "Woven on pit looms in the Kashmir valley.",
  lead_time_days: 21,
  lead_time_label: null,
  min_order_quantity: 50,
  made_to_order: true,
}

const scopeWith = (
  over: {
    partners?: any[]
    products?: any[]
    profile?: any
    graphThrows?: boolean
    profileThrows?: boolean
    captureFilters?: any[]
  } = {}
) => ({
  resolve: (key: string) => {
    if (String(key) === "partner_onboarding_profile") {
      return {
        findByPartner: async () => {
          if (over.profileThrows) throw new Error("module fell over")
          return over.profile === undefined ? PROFILE : over.profile
        },
      }
    }
    return {
      graph: async (args: any) => {
        if (over.graphThrows) throw new Error("query fell over")
        over.captureFilters?.push({ entity: args.entity, filters: args.filters })
        // 🔑 Never an unfiltered read. `filters: { id: undefined }` is NO
        // FILTER, not "no rows" (#1433) — here it would read every artisan
        // detail row in the database onto one buyer's page.
        expect(args.filters?.id).toBeDefined()
        if (args.entity === "partners") {
          return { data: over.partners === undefined ? [PARTNER] : over.partners }
        }
        if (args.entity === "product") {
          return { data: over.products ?? [] }
        }
        return { data: [] }
      },
    }
  },
})

describe("consensusArtisanDetail", () => {
  it("keeps everything for a single-product quote", () => {
    expect(consensusArtisanDetail([DETAIL_A], 1)).toEqual(DETAIL_A)
  })

  it("keeps only the fields every product agrees on", () => {
    const res = consensusArtisanDetail(
      [DETAIL_A, { ...DETAIL_A, lead_time_days: 40, maker_story: "A different story." }],
      2
    )
    expect(res?.min_order_quantity).toBe(50)
    expect(res?.made_to_order).toBe(true)
    // The two facts that disagreed are gone, not averaged and not first-wins.
    expect(res?.lead_time_days).toBeNull()
    expect(res?.maker_story).toBeNull()
  })

  it("drops everything when one quoted product has no detail row at all", () => {
    // Unanimous across the two rows that exist — but still a false statement
    // about the third product, which we know nothing about.
    expect(consensusArtisanDetail([DETAIL_A, DETAIL_A, null], 3)).toBeNull()
  })

  it("is null when no product carries a detail row", () => {
    expect(consensusArtisanDetail([null, null], 2)).toBeNull()
  })
})

describe("hasProvenance", () => {
  it("is false for a partner we know nothing about", () => {
    expect(hasProvenance({ maker_name: null, maker_story: null, rows: [] })).toBe(false)
  })

  it("is true when there is a story but no rows", () => {
    expect(
      hasProvenance({ maker_name: null, maker_story: "Woven by hand.", rows: [] })
    ).toBe(true)
  })
})

describe("resolveQuoteProvenance", () => {
  it("shapes partner, profile and the basket's agreed product facts", async () => {
    const res = await resolveQuoteProvenance(
      scopeWith({ products: [{ id: "prod_a", artisan_product_detail: DETAIL_A }] }) as any,
      { partner_id: "part_1", product_ids: ["prod_a"] }
    )

    expect(res?.maker_name).toBe("Unique Pashmina")
    expect(res?.maker_story).toBe("Woven on pit looms in the Kashmir valley.")
    expect(res?.rows.map((r) => r.key)).toEqual([
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

  it("publishes NO commercial term, whatever the profile row carries", async () => {
    const res = await resolveQuoteProvenance(
      scopeWith({ products: [{ id: "prod_a", artisan_product_detail: DETAIL_A }] }) as any,
      { partner_id: "part_1", product_ids: ["prod_a"] }
    )

    const published = JSON.stringify(res).toLowerCase()
    for (const leak of [
      "commission",
      "1500",
      "luxury",
      "price_range",
      "payment_collection",
      "through_us",
      "selling_mode",
      "core_channel_listing",
    ]) {
      expect(published).not.toContain(leak)
    }
  })

  it("keeps the partner half when the basket's products disagree", async () => {
    const res = await resolveQuoteProvenance(
      scopeWith({
        products: [
          { id: "prod_a", artisan_product_detail: DETAIL_A },
          {
            id: "prod_b",
            artisan_product_detail: { ...DETAIL_A, maker_story: "Another story.", lead_time_days: 40 },
          },
        ],
      }) as any,
      { partner_id: "part_1", product_ids: ["prod_a", "prod_b"] }
    )

    // Who they are still holds for the whole basket…
    expect(res?.rows.map((r) => r.key)).toContain("maker")
    expect(res?.rows.map((r) => r.key)).toContain("weaving")
    // …but a per-product claim that isn't basket-wide is silent, not blended.
    expect(res?.rows.map((r) => r.key)).not.toContain("lead_time")
    expect(res?.maker_story).toBeNull()
  })

  it("degrades to fewer rows for a sparse partner, never to blank ones", async () => {
    const res = await resolveQuoteProvenance(
      scopeWith({
        partners: [{ id: "part_1", name: "Thin Partner", status: "active" }],
        profile: null,
        products: [],
      }) as any,
      { partner_id: "part_1", product_ids: [] }
    )

    expect(res?.rows.map((r) => r.key)).toEqual(["maker"])
    expect(res?.rows.every((r) => Boolean(r.value))).toBe(true)
    expect(res?.maker_story).toBeNull()
  })

  it("never queries products when the quote has none to name", async () => {
    const captureFilters: any[] = []
    await resolveQuoteProvenance(
      scopeWith({ captureFilters, profile: null }) as any,
      { partner_id: "part_1", product_ids: [null, undefined as any] }
    )

    expect(captureFilters.map((c) => c.entity)).toEqual(["partners"])
  })

  it("says nothing rather than 500ing when the query falls over", async () => {
    const res = await resolveQuoteProvenance(scopeWith({ graphThrows: true }) as any, {
      partner_id: "part_1",
      product_ids: ["prod_a"],
    })
    expect(res).toBeNull()
  })

  it("survives a partner who never finished onboarding", async () => {
    const res = await resolveQuoteProvenance(
      scopeWith({ profileThrows: true, products: [] }) as any,
      { partner_id: "part_1", product_ids: [] }
    )
    // The name and country are partner-level; the profile rows are simply gone.
    expect(res?.rows.map((r) => r.key)).toEqual(["maker", "country", "verified"])
  })

  it("says nothing for an inactive partner", async () => {
    const res = await resolveQuoteProvenance(
      scopeWith({ partners: [{ ...PARTNER, status: "suspended" }] }) as any,
      { partner_id: "part_1", product_ids: ["prod_a"] }
    )
    expect(res).toBeNull()
  })

  it("says nothing when the quote has no partner", async () => {
    const res = await resolveQuoteProvenance(scopeWith() as any, { partner_id: null })
    expect(res).toBeNull()
  })

  it("returns null rather than an empty section when nothing is known", async () => {
    const res = await resolveQuoteProvenance(
      scopeWith({ partners: [{ id: "part_1", status: "active" }], profile: null }) as any,
      { partner_id: "part_1", product_ids: [] }
    )
    expect(res).toBeNull()
  })
})

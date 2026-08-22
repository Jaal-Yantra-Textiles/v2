import {
  buildQuoteView,
  pickLineImage,
  buyerChangedInputs,
  composeQuoteMoney,
  frozenMoney,
  pickFreightOption,
} from "../lib/build-quote-view"

/**
 * The one builder. Three callers — public page, email, and mint (where this
 * same output is frozen) — so if these tests pass, the page and the email
 * cannot disagree about a number.
 *
 * The assertion that matters most is the QueryContext one. `calculated_price`
 * is the QUANTITY-1 price on every `/store/*` route because only the cart sets
 * `context.quantity`; a tiered "price at 500" rendered without it is silently
 * the price at 1. That is not a detail to preserve on refactor — it is the
 * feature.
 */

const VARIANTS = [
  {
    id: "var_a",
    title: "Plain / Natural",
    weight: 105,
    // Deliberately out of rank order, and the product carries a DIFFERENT
    // thumbnail — so "took the variant image" and "took the first row" and
    // "fell back to the product" are three distinguishable outcomes.
    images: [
      { url: "https://cdn/var-a-2.jpg", rank: 1 },
      { url: "https://cdn/var-a-1.jpg", rank: 0 },
    ],
    product: {
      id: "prod_a",
      title: "Pashmina Plain",
      handle: "pashmina-plain",
      weight: 115,
      thumbnail: "https://cdn/prod-a.jpg",
    },
  },
  {
    id: "var_b",
    title: "Striped / Indigo",
    weight: null,
    images: [],
    product: {
      id: "prod_b",
      title: "Pashmina Striped",
      handle: "pashmina-striped",
      weight: 200,
      thumbnail: "https://cdn/prod-b.jpg",
    },
  },
]

type Captured = { contexts: any[]; rateWeights: number[] }

const scopeWith = (
  captured: Captured,
  over: {
    manual?: any[]
    noOriginPostalCode?: boolean
    partner?: any
    profile?: any
    artisanDetail?: any
  } = {}
) => {
  const manualOptions = over.manual ?? []
  return {
    resolve: (key: string) => {
      if (String(key) === "partner_onboarding_profile") {
        return { findByPartner: async () => over.profile ?? null }
      }
      if (String(key).includes("cach")) {
        return { get: async () => null, set: async () => {} }
      }
      if (String(key).includes("logger")) {
        return { warn: () => {} }
      }
      return {
        graph: async (args: any) => {
          if (args.entity === "variant" && args.fields.includes("calculated_price.*")) {
            captured.contexts.push(args.context)
            const id = args.filters.id
            // A deliberately quantity-sensitive price, so a lost quantity shows
            // up as a wrong number rather than as an equal one.
            const quantity =
              JSON.parse(JSON.stringify(args.context)).calculated_price?.quantity ?? 1
            return {
              data: [
                {
                  id,
                  calculated_price: {
                    calculated_amount: quantity >= 100 ? 800 : 1000,
                  },
                },
              ],
            }
          }
          if (args.entity === "variant") {
            const ids = Array.isArray(args.filters.id) ? args.filters.id : [args.filters.id]
            return { data: VARIANTS.filter((v) => ids.includes(v.id)) }
          }
          if (args.entity === "partners") {
            return { data: over.partner ? [over.partner] : [] }
          }
          if (args.entity === "product") {
            return {
              data: over.artisanDetail
                ? [{ id: "prod_a", artisan_product_detail: over.artisanDetail }]
                : [],
            }
          }
          if (args.entity === "stock_locations") {
            if (args.fields.some((f: string) => f.includes("fulfillment_sets"))) {
              return {
                data: [
                  {
                    id: "loc_1",
                    fulfillment_sets: [
                      {
                        service_zones: [
                          {
                            // A zone with no geo zones covers NOTHING (#1424),
                            // so a manual fixture has to declare its lane.
                            geo_zones: manualOptions.length
                              ? [{ country_code: "in" }]
                              : [],
                            shipping_options: manualOptions,
                          },
                        ],
                      },
                    ],
                  },
                ],
              }
            }
            return {
              data: [
                {
                  id: "loc_1",
                  address: {
                    postal_code: over.noOriginPostalCode ? "" : "110001",
                  },
                },
              ],
            }
          }
          return { data: [] }
        },
      }
    },
  }
}

// The shipping provider is resolved through the module registry, so it is
// stubbed at the module boundary rather than through the container.
jest.mock("../../shipping-providers/resolver", () => ({
  resolveShippingProvider: async () => ({
    getRates: async (args: any) => {
      ;(global as any).__rateWeights = [
        ...((global as any).__rateWeights || []),
        args.weight_grams,
      ]
      return [
        { courier_id: "c1", courier_name: "Delhivery", amount: 4200, currency_code: "inr", estimated_days: 4 },
        { courier_id: "c2", courier_name: "Blue Dart", amount: 3900, currency_code: "inr", estimated_days: 3 },
      ]
    },
  }),
}))

const baseInput = (over: any = {}) => ({
  lines: [{ variant_id: "var_a", quantity: 500 }],
  destination_country_code: "in",
  destination_postal_code: "560001",
  currency_code: "inr",
  region_id: "reg_in",
  store: { id: "store_1", default_location_id: "loc_1" },
  now: new Date("2026-08-21T00:00:00Z"),
  ...over,
})

beforeEach(() => {
  ;(global as any).__rateWeights = []
})

describe("buildQuoteView — pricing", () => {
  it("prices EVERY line with an explicit quantity in the QueryContext", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({
        lines: [
          { variant_id: "var_a", quantity: 500 },
          { variant_id: "var_b", quantity: 20 },
        ],
      })
    )

    expect(captured.contexts).toHaveLength(2)
    const quantities = captured.contexts.map(
      (c) => JSON.parse(JSON.stringify(c)).calculated_price.quantity
    )
    // Per line, never blended: 500 and 20 are two different tiers.
    expect(quantities).toEqual([500, 20])
  })

  it("carries region and currency into the pricing context", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    await buildQuoteView(scopeWith(captured) as any, baseInput())

    const ctx = JSON.parse(JSON.stringify(captured.contexts[0])).calculated_price
    expect(ctx.region_id).toBe("reg_in")
    expect(ctx.currency_code).toBe("inr")
  })

  it("lands a tiered price, not the qty-1 price", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(scopeWith(captured) as any, baseInput())

    // 800 is the >=100 tier in the stub. 1000 would mean the quantity was lost.
    expect(view.lines[0].live_unit_amount).toBe(800)
    expect(view.lines[0].live_subtotal).toBe(400_000)
  })
})

describe("buildQuoteView — freight", () => {
  it("quotes ONE consignment on the summed weight, not one per line", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({
        lines: [
          { variant_id: "var_a", quantity: 500 },
          { variant_id: "var_b", quantity: 20 },
        ],
      })
    )

    // 500 × 105 g + 20 × 200 g (product fallback) = 56,500 g → bucketed 56,500.
    expect(view.total_weight_grams).toBe(56_500)
    // ONE carrier call. Per-line freight would bill several deliveries the
    // buyer is not getting.
    expect((global as any).__rateWeights).toHaveLength(1)
    expect(view.freight.chosen?.amount).toBe(3900)
  })

  it("records the weight source per line, because a basket can mix them", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({
        lines: [
          { variant_id: "var_a", quantity: 500 },
          { variant_id: "var_b", quantity: 20 },
        ],
      })
    )

    expect(view.lines.find((l) => l.variant_id === "var_a")?.weight_source).toBe("variant")
    // var_b has no weight of its own — the product's 200 g is an over-quote,
    // and saying so is the whole point of the column.
    expect(view.lines.find((l) => l.variant_id === "var_b")?.weight_source).toBe("product")
  })

  it("has no live half at all when freight cannot be quoted, and says why", async () => {
    // A landed total with no freight in it is a wrong number wearing a
    // confident label. The quoted half — what the partner actually told this
    // buyer — is still worth showing.
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, { noOriginPostalCode: true }) as any,
      baseInput({
        quote: {
          status: "active",
          quoted_subtotal: 400_000,
          quoted_freight: 3900,
          quoted_landed_total: 403_900,
          lines: [{ variant_id: "var_a", quantity: 500 }],
        },
      })
    )

    expect(view.live).toBeNull()
    expect(view.live_error).toMatch(/postal code/i)
    expect(view.quoted?.landed_total).toBe(403_900)
    expect(view.compare.show_quoted).toBe(true)
  })
})

describe("buildQuoteView — the free-shipping row that quoted every bulk consignment at zero", () => {
  /**
   * Found on the FIRST live prod B2B quote: ₹36,00,000, 21 kg to Mumbai,
   * `quoted_freight: 0`.
   *
   * `create-store-with-defaults` gives every Indian store a second price row of
   * 0 INR gated on `item_total >= 2999` — retail free shipping. The estimate
   * read `prices[]` and pushed every row as its own option WITHOUT looking at
   * `price_rules`, so the 0 was always on the lane and always the cheapest.
   *
   * This is the third blindness on the same picker: zone, currency (both
   * #1424), and now rule.
   */
  const FREE_OVER_2999 = {
    id: "so_flat",
    name: "Domestic Shipping",
    price_type: "flat",
    prices: [
      { amount: 99, currency_code: "inr", price_rules: [] },
      {
        amount: 0,
        currency_code: "inr",
        price_rules: [
          { attribute: "item_total", operator: "gte", value: "2999" },
        ],
      },
    ],
  }

  it("does not take a rule-bound 0 as the cheapest option", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, { manual: [FREE_OVER_2999] }) as any,
      baseInput()
    )

    // 0 would be the bug. 99 is the unconditional flat, and it is genuinely
    // cheaper than the 3900 carrier rate, so it is the honest answer here.
    expect(view.freight.chosen?.amount).toBe(99)
    expect(view.live?.freight).toBe(99)
    expect(view.freight.options.map((o) => o.amount)).not.toContain(0)
  })

  it("drops the conditional row even when it is the ONLY price", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, {
        manual: [{ ...FREE_OVER_2999, prices: [FREE_OVER_2999.prices[1]] }],
      }) as any,
      baseInput()
    )

    // The estimate has no cart and must not guess: with nothing unconditional
    // on the lane, the carrier rate stands rather than a free ride.
    expect(view.freight.chosen?.amount).toBe(3900)
  })

  it("still keeps an ordinary unconditional flat price", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, {
        manual: [{ ...FREE_OVER_2999, prices: [FREE_OVER_2999.prices[0]] }],
      }) as any,
      baseInput()
    )

    expect(view.freight.chosen?.amount).toBe(99)
  })
})

describe("buildQuoteView — the missing pickup location that read every tenant", () => {
  /**
   * Found on the SECOND live prod mint. The public `/store/b2b/quotes/:token`
   * route passed `store: { id }` and no `default_location_id`, and
   * `filters: { id: undefined }` is NOT "no location" — it is NO FILTER.
   *
   * The buyer's page therefore collected manual shipping options from EVERY
   * stock location on the platform. A Mumbai consignment was offered another
   * partner's "European Shipping", "Private" and "In Person Pickup", while this
   * store's own domestic option was missing — so the page's freight disagreed
   * with the freight the mint had frozen minutes earlier.
   *
   * A cross-tenant read on a public, unauthenticated route: the #1397 shape.
   * A missing origin cannot produce a right answer, so it must not produce a
   * confident wrong one.
   */
  it("refuses to price at all when no pickup location was given", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({ store: { id: "store_1" } })
    )

    // No live half, and it says why — rather than a landed total built from
    // somebody else's shipping options.
    expect(view.live).toBeNull()
    expect(view.live_error).toMatch(/pickup location/i)
    expect(view.live_error).toMatch(/every location on the platform/i)
  })

  it("still prices normally once the location is given", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(scopeWith(captured) as any, baseInput())

    expect(view.live).not.toBeNull()
  })
})

describe("buildQuoteView — an INR carrier rate on a EUR quote", () => {
  /**
   * Found on the FIRST live international quote: Srinagar → Berlin, 3 kg, EUR.
   *
   * Carriers answer in their OWN currency. Shiprocket returned ₹3,788 /
   * ₹5,232.50 / ₹14,436 alongside a €35 manual flat, and €35 won ONLY because
   * 35 is the smallest raw number. Take the flat away and `composeQuoteMoney`
   * adds 3788 straight onto a EUR subtotal: €4,718 becomes €8,506, rendered
   * with a € sign.
   *
   * #1424 put this guard on the MANUAL branch and stopped there. The stub here
   * quotes in INR, so an EUR quote must see no calculated option at all.
   */
  const EUR_FLAT = {
    id: "so_intl",
    name: "International Shipping",
    price_type: "flat",
    prices: [{ amount: 35, currency_code: "eur", price_rules: [] }],
  }

  it("never lets an INR carrier rate into a EUR total", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, { manual: [EUR_FLAT] }) as any,
      baseInput({ currency_code: "eur", lines: [{ variant_id: "var_a", quantity: 29 }] })
    )

    // The INR stub rates (3900 / 4200) are cheaper as raw numbers than nothing,
    // and 3900 would have been ADDED to a EUR subtotal.
    expect(view.freight.options.every((o) => o.currency_code === "eur")).toBe(true)
    expect(view.freight.chosen?.amount).toBe(35)
    expect(view.freight.chosen?.currency_code).toBe("eur")
  })

  it("has no live half at all when only foreign-currency rates exist", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({ currency_code: "eur" })
    )

    // No EUR option on the lane. Refusing is the point — a landed total built
    // from an INR number would look perfectly ordinary.
    expect(view.live).toBeNull()
    expect(view.live_error).toMatch(/freight/i)
  })

  it("still keeps INR rates on an INR quote", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(scopeWith(captured) as any, baseInput())

    // The guard must not over-correct into dropping the domestic case.
    expect(view.freight.chosen?.amount).toBe(3900)
    expect(view.freight.chosen?.currency_code).toBe("inr")
  })
})

describe("buildQuoteView — lifecycle", () => {
  it("never re-prices a revoked link", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({ quote: { status: "revoked", lines: [{ variant_id: "var_a", quantity: 500 }] } })
    )

    expect(view.live).toBeNull()
    expect(captured.contexts).toHaveLength(0)
    expect(view.compare.state).toBe("dead_link")
  })

  it("never re-prices an expired link, but still names what was quoted", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({
        quote: {
          status: "active",
          expires_at: "2026-08-01T00:00:00Z",
          lines: [{ variant_id: "var_a", quantity: 500 }],
        },
      })
    )

    expect(view.live).toBeNull()
    expect(captured.contexts).toHaveLength(0)
    expect(view.lines[0].product_title).toBe("Pashmina Plain")
  })

  it("refuses an empty basket rather than quoting nothing", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    await expect(
      buildQuoteView(scopeWith(captured) as any, baseInput({ lines: [] }))
    ).rejects.toThrow(/at least one line/)
  })
})

describe("pure helpers", () => {
  it("picks the cheapest option, not the carrier's recommendation", () => {
    const chosen = pickFreightOption({
      calculated: [
        { amount: 4200, currency_code: "inr", source: "calculated", is_recommended: true },
        { amount: 3900, currency_code: "inr", source: "calculated" },
      ] as any,
      manual: [{ amount: 5000, currency_code: "inr", source: "manual" }] as any,
    })

    expect(chosen?.amount).toBe(3900)
  })

  it("returns null when the lane has no quotable option", () => {
    expect(pickFreightOption({ calculated: [], manual: [] })).toBeNull()
  })

  it("sums line subtotals and adds ONE freight leg", () => {
    const money = composeQuoteMoney([400_000, 20_000], 520, 3900)

    expect(money.subtotal).toBe(420_000)
    expect(money.freight).toBe(3900)
    expect(money.landed_total).toBe(423_900)
    // The basket's blended per-unit figure, for the summary row only.
    expect(money.unit_amount).toBeCloseTo(807.69, 2)
  })

  it("reports no frozen half before the first freeze", () => {
    expect(frozenMoney(null)).toBeNull()
    expect(frozenMoney({ quoted_landed_total: null })).toBeNull()
  })

  it("reads the frozen totals back", () => {
    const money = frozenMoney({
      quoted_subtotal: 420_000,
      quoted_freight: 3900,
      quoted_landed_total: 423_900,
      lines: [{ variant_id: "var_a", quantity: 520 }],
    })

    expect(money?.landed_total).toBe(423_900)
    expect(money?.unit_amount).toBeCloseTo(807.69, 2)
  })
})

describe("the line image (#1428)", () => {
  it("prefers the variant's own image over the product thumbnail", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({
        lines: [
          { variant_id: "var_a", quantity: 500 },
          { variant_id: "var_b", quantity: 20 },
        ],
      })
    )

    const a = view.lines.find((l) => l.variant_id === "var_a")
    // Rank 0, not the first row of the array — the merchandiser's ordering
    // decides which photo the buyer sees.
    expect(a?.thumbnail).toBe("https://cdn/var-a-1.jpg")
    expect(a?.image_source).toBe("variant")
    // prod_a also has a thumbnail; taking it would have been the bug.
    expect(a?.thumbnail).not.toBe("https://cdn/prod-a.jpg")

    const b = view.lines.find((l) => l.variant_id === "var_b")
    expect(b?.thumbnail).toBe("https://cdn/prod-b.jpg")
    expect(b?.image_source).toBe("product")
  })

  it("says nothing when neither level has an image", () => {
    // A plausible WRONG image on a quote is worse than an empty cell — the
    // buyer is agreeing to *that* item.
    expect(pickLineImage({ images: [], product: {} })).toEqual({
      thumbnail: null,
      image_source: null,
    })
    expect(pickLineImage(undefined)).toEqual({
      thumbnail: null,
      image_source: null,
    })
  })

  it("ignores image rows that carry no url", () => {
    expect(
      pickLineImage({
        images: [{ url: null, rank: 0 }],
        product: { thumbnail: "https://cdn/p.jpg" },
      })
    ).toEqual({ thumbnail: "https://cdn/p.jpg", image_source: "product" })
  })
})

describe("buyerChangedInputs", () => {
  const quote = {
    destination_postal_code: "560001",
    lines: [
      { variant_id: "var_a", quantity: 500 },
      { variant_id: "var_b", quantity: 20 },
    ],
  }

  it("is false at mint, when there is nothing to have changed from", () => {
    expect(buyerChangedInputs(null, { lines: [{ variant_id: "var_a", quantity: 1 }] })).toBe(false)
  })

  it("is false when the basket and destination match what was quoted", () => {
    expect(
      buyerChangedInputs(quote, {
        lines: [
          { variant_id: "var_a", quantity: 500 },
          { variant_id: "var_b", quantity: 20 },
        ],
        destination_postal_code: "560001",
      })
    ).toBe(false)
  })

  it("notices a nudged quantity", () => {
    expect(
      buyerChangedInputs(quote, {
        lines: [
          { variant_id: "var_a", quantity: 600 },
          { variant_id: "var_b", quantity: 20 },
        ],
        destination_postal_code: "560001",
      })
    ).toBe(true)
  })

  it("notices a line removed, not just a quantity changed", () => {
    expect(
      buyerChangedInputs(quote, {
        lines: [{ variant_id: "var_a", quantity: 500 }],
        destination_postal_code: "560001",
      })
    ).toBe(true)
  })

  it("notices a swapped variant even at the same line count and quantity", () => {
    expect(
      buyerChangedInputs(quote, {
        lines: [
          { variant_id: "var_a", quantity: 500 },
          { variant_id: "var_c", quantity: 20 },
        ],
        destination_postal_code: "560001",
      })
    ).toBe(true)
  })

  it("notices a new destination", () => {
    expect(
      buyerChangedInputs(quote, {
        lines: [
          { variant_id: "var_a", quantity: 500 },
          { variant_id: "var_b", quantity: 20 },
        ],
        destination_postal_code: "400001",
      })
    ).toBe(true)
  })
})

/**
 * #1439 S9 — the maker section. The shaper and its resolver have their own
 * suites; what matters HERE is only that the view carries the section and that
 * a partner we cannot resolve costs a credit line rather than the whole page.
 */
describe("buildQuoteView — provenance", () => {
  it("carries the maker section for a quote with a partner", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, {
        partner: {
          id: "part_1",
          name: "Unique Pashmina",
          country_code: "IN",
          is_verified: true,
          status: "active",
        },
        profile: { person_type: "artisan", does_weaving: true },
        artisanDetail: { maker_story: "Woven on pit looms.", lead_time_days: 21 },
      }) as any,
      baseInput({ partner_id: "part_1" })
    )

    expect(view.provenance?.maker_name).toBe("Unique Pashmina")
    expect(view.provenance?.maker_story).toBe("Woven on pit looms.")
    expect(view.provenance?.rows.map((r) => r.key)).toContain("weaving")
  })

  it("prices the quote regardless of whether provenance resolves", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({ partner_id: "part_missing" })
    )

    // Null is "say nothing", and the money is untouched by it.
    expect(view.provenance).toBeNull()
    expect(view.live?.landed_total).toBeGreaterThan(0)
  })
})

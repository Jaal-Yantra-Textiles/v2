import {
  buildQuoteView,
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
    product: { id: "prod_a", title: "Pashmina Plain", handle: "pashmina-plain", weight: 115 },
  },
  {
    id: "var_b",
    title: "Striped / Indigo",
    weight: null,
    product: { id: "prod_b", title: "Pashmina Striped", handle: "pashmina-striped", weight: 200 },
  },
]

type Captured = { contexts: any[]; rateWeights: number[] }

const scopeWith = (
  captured: Captured,
  over: { manual?: any[]; noOriginPostalCode?: boolean } = {}
) => {
  const manualOptions = over.manual ?? []
  return {
    resolve: (key: string) => {
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

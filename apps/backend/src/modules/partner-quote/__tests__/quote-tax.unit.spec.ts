import {
  composeQuoteMoney,
  frozenMoney,
  frozenTaxFallback,
} from "../lib/build-quote-view"
import {
  classifyQuoteJurisdiction,
  exportDisclosureReason,
  foldTaxLines,
  resolveQuoteTax,
  unknownOriginReason,
  unknownTaxReason,
} from "../lib/quote-tax"

/**
 * Tax on a quote (#1439 S8).
 *
 * Two assertions carry this file.
 *
 * 1. **Inclusive vs exclusive is an 18% error in the confident direction.**
 *    When the prices already contain the tax, adding it again overcharges the
 *    buyer by exactly the tax; when they do not, failing to add it under-quotes
 *    a number the buyer is budgeting against. Both directions are pinned.
 * 2. **Unknown is never zero.** `tax_total` and `gross_total` stay null
 *    whenever the tax could not be determined, so no caller can add a
 *    fabricated zero into a total. A quote that says "0 tax" is making a claim.
 */

describe("foldTaxLines", () => {
  const goods = [{ id: "var_a", amount: 1000, on: "goods" as const }]
  const withFreight = [
    ...goods,
    { id: "quote-freight", amount: 200, on: "freight" as const },
  ]
  const gst = (id: string) => ({
    line_item_id: id,
    rate: 18,
    code: "IN-GST",
    name: "India GST",
  })

  it("adds tax on top when the prices are tax-EXCLUSIVE", () => {
    const { total } = foldTaxLines(goods, [gst("var_a")], false)
    expect(total).toBe(180)
  })

  it("EXTRACTS tax from the price when they are tax-INCLUSIVE", () => {
    // 1000 gross at 18% is 152.54 of tax, not 180 — the difference is the tax
    // on the tax, and adding 180 here would overcharge every Indian quote.
    const { total } = foldTaxLines(goods, [gst("var_a")], true)
    expect(total).toBeCloseTo(152.54, 2)
  })

  it("taxes the freight leg as well as the goods", () => {
    const lines = [gst("var_a"), { ...gst("x"), line_item_id: undefined, shipping_line_id: "quote-freight" }]
    const { total, rates } = foldTaxLines(withFreight, lines as any, false)
    expect(total).toBe(216) // 180 on goods + 36 on freight
    // Two entries at the SAME percentage: "18% on goods" and "18% on freight"
    // are facts a buyer reads separately.
    expect(rates.map((r) => r.on).sort()).toEqual(["freight", "goods"])
  })

  it("ignores a taxable item the module returned no line for", () => {
    // A zero-rated region returns a line AT rate 0; no line at all means the
    // item was not matched, and inventing tax for it would be worse than none.
    const { total, rates } = foldTaxLines(withFreight, [gst("var_a")], false)
    expect(total).toBe(180)
    expect(rates).toHaveLength(1)
  })

  it("carries a configured ZERO rate through as a real, calculated zero", () => {
    const { total, rates } = foldTaxLines(
      goods,
      [{ line_item_id: "var_a", rate: 0, code: "GB-ZERO", name: "Zero rated" }],
      false
    )
    // 🔑 This zero is a fact — a region that says "0%". It is a different
    // thing from the null a missing region produces, and only one of the two
    // may be shown to a buyer as a number.
    expect(total).toBe(0)
    expect(rates[0].code).toBe("GB-ZERO")
  })

  it("names the destination when it has to say it does not know", () => {
    expect(unknownTaxReason("gb")).toContain("GB")
    expect(unknownTaxReason("")).toContain("this destination")
  })
})

describe("composeQuoteMoney with tax", () => {
  const lines = [1000]

  it("leaves tax UNKNOWN when none was resolved — never zero", () => {
    const money = composeQuoteMoney(lines, 10, 200)
    expect(money.landed_total).toBe(1200)
    // Both null: a caller that adds these gets NaN and notices, which is the
    // point. A 0 would silently become "no tax due".
    expect(money.tax_total).toBeNull()
    expect(money.gross_total).toBeNull()
  })

  it("ADDS tax to the gross when prices are tax-exclusive", () => {
    const money = composeQuoteMoney(lines, 10, 200, {
      total: 216,
      inclusive: false,
    })
    expect(money.landed_total).toBe(1200)
    expect(money.gross_total).toBe(1416)
  })

  it("🔴 does NOT add tax again when prices are tax-inclusive", () => {
    const money = composeQuoteMoney(lines, 10, 200, {
      total: 183.05,
      inclusive: true,
    })
    // The tax is already inside the 1200. Adding it would overcharge the buyer
    // by the whole tax amount.
    expect(money.gross_total).toBe(1200)
    // …and it is still disclosed, because a buyer reclaiming input credit
    // needs the figure.
    expect(money.tax_total).toBe(183.05)
  })

  it("keeps landed_total meaning exactly what it always meant", () => {
    // Widening it would silently change every frozen `quoted_landed_total`
    // already on disk and every comparison drawn against one.
    const taxed = composeQuoteMoney(lines, 10, 200, { total: 216, inclusive: false })
    const untaxed = composeQuoteMoney(lines, 10, 200)
    expect(taxed.landed_total).toBe(untaxed.landed_total)
  })
})

describe("frozenMoney with tax", () => {
  const base = {
    quoted_subtotal: 1000,
    quoted_freight: 200,
    quoted_landed_total: 1200,
    lines: [{ variant_id: "var_a", quantity: 10 }],
  }

  it("reports UNKNOWN tax for a quote minted before tax existed", () => {
    const money = frozenMoney(base as any)
    // Those rows genuinely have no tax figure. Defaulting to 0 would
    // retroactively assert that an untaxed quote was tax-free.
    expect(money?.tax_total).toBeNull()
    expect(money?.gross_total).toBeNull()
  })

  it("reads a frozen tax figure back on its recorded basis", () => {
    const exclusive = frozenMoney({
      ...base,
      quoted_tax_total: 216,
      quoted_tax_inclusive: false,
    } as any)
    expect(exclusive?.gross_total).toBe(1416)

    const inclusive = frozenMoney({
      ...base,
      quoted_tax_total: 183.05,
      quoted_tax_inclusive: true,
    } as any)
    expect(inclusive?.gross_total).toBe(1200)
  })
})

/**
 * Jurisdiction (#1447 / #1439 S8).
 *
 * The first cut asked the Tax module using the destination country alone, which
 * assumes the seller is registered wherever the buyer is. Goods on this platform
 * always dispatch from India, so that put 19% German VAT on an Indian export —
 * a fifth added to the headline number of every EU quote.
 */
describe("classifyQuoteJurisdiction", () => {
  it("is domestic when the goods do not cross a border", () => {
    expect(classifyQuoteJurisdiction("IN", "IN")).toBe("domestic")
  })

  it("is an export whenever origin and destination differ", () => {
    expect(classifyQuoteJurisdiction("IN", "DE")).toBe("export")
    expect(classifyQuoteJurisdiction("IN", "GB")).toBe("export")
    // Latvia is not special. KHT invoices as JYT's disclosed agent and is not
    // VAT-registered, so an LV buyer is still an Indian export.
    expect(classifyQuoteJurisdiction("IN", "LV")).toBe("export")
  })

  it("normalises case and whitespace on both sides", () => {
    expect(classifyQuoteJurisdiction(" in ", "In")).toBe("domestic")
    expect(classifyQuoteJurisdiction("in", "de")).toBe("export")
  })

  it("refuses to guess rather than assuming domestic", () => {
    // Assuming domestic would put a confident 18% on a quote we cannot place —
    // the same failure as a confident zero, in the other direction.
    expect(classifyQuoteJurisdiction(null, "DE")).toBe("unknown_origin")
    expect(classifyQuoteJurisdiction("", "DE")).toBe("unknown_origin")
    expect(classifyQuoteJurisdiction("IND", "DE")).toBe("unknown_origin")
    expect(classifyQuoteJurisdiction("IN", "")).toBe("unknown_origin")
  })
})

describe("export and unknown-origin wording", () => {
  it("names both countries and puts duty on the buyer, explicitly", () => {
    const reason = exportDisclosureReason("in", "de")
    expect(reason).toMatch(/export from IN to DE/)
    expect(reason).toMatch(/zero-rated/)
    // The half that matters: the zero is real, the omission is not.
    expect(reason).toMatch(/duty/i)
    expect(reason).toMatch(/payable by you/i)
    expect(reason).toMatch(/NOT included/)
  })

  it("says the origin is unknown rather than implying no tax is due", () => {
    const reason = unknownOriginReason("de")
    expect(reason).toMatch(/could not establish/i)
    expect(reason).toMatch(/DE/)
    expect(reason).not.toMatch(/zero-rated/)
  })
})

/**
 * Freezing the tax (#1439 S8 tail).
 *
 * S8 computed tax only at READ time, so a rate change moved the tax on a quote
 * already sent while the subtotal and freight frozen beside it stayed put — the
 * quote silently disagreed with itself.
 *
 * The sharper bug the fallback fixes: `buildQuoteView` skips its whole live
 * block when the quote is revoked/superseded/expired, leaving `tax` on its
 * `{status:"unknown", reason:null}` default. The page renders its notice only
 * when there IS a reason, so a dead link showed frozen totals and NO tax block
 * — "a missing tax block reads as no tax due", landing on precisely the quotes
 * that exist as a record of what was said.
 */
describe("frozenTaxFallback", () => {
  const liveUnknownEmpty = {
    status: "unknown" as const,
    total: null,
    inclusive: false,
    rates: [],
    reason: null,
  }

  const frozenExport = {
    quoted_tax_total: 0,
    quoted_tax_inclusive: false,
    quoted_tax_status: "zero_rated_export",
    quoted_tax_reason:
      "This is an export from IN to DE, so it is zero-rated and no seller tax is charged. Import duty and import VAT/GST are payable by you to DE customs on arrival and are NOT included in this total.",
  }

  it("shows what the buyer was told when the live half produced nothing", () => {
    const r = frozenTaxFallback(liveUnknownEmpty, frozenExport)
    expect(r.status).toBe("zero_rated_export")
    expect(r.total).toBe(0)
    // The half that matters on a dead export quote.
    expect(r.reason).toMatch(/payable by you/i)
  })

  it("a LIVE answer always wins, including a live unknown that has a reason", () => {
    // That reason describes the quote as it stands now; the frozen one does not.
    const liveWithReason = {
      ...liveUnknownEmpty,
      reason: "No tax rate is configured for DE.",
    }
    expect(frozenTaxFallback(liveWithReason, frozenExport).reason).toBe(
      "No tax rate is configured for DE."
    )

    const liveCalculated = {
      status: "calculated" as const,
      total: 18,
      inclusive: false,
      rates: [],
      reason: null,
    }
    expect(frozenTaxFallback(liveCalculated, frozenExport).status).toBe(
      "calculated"
    )
  })

  it("stays unknown for a quote minted before tax existed", () => {
    // No frozen status ⇒ nothing to fall back to. Inventing one would claim a
    // tax treatment for a row that never had one.
    expect(frozenTaxFallback(liveUnknownEmpty, {}).status).toBe("unknown")
    expect(frozenTaxFallback(liveUnknownEmpty, null).reason).toBeNull()
  })

  it("does not resurrect a rate breakdown alongside a frozen total", () => {
    // Reprinting last week's percentages next to a frozen number invites the
    // reader to re-derive it and find it does not reconcile.
    expect(frozenTaxFallback(liveUnknownEmpty, frozenExport).rates).toEqual([])
  })

  it("distinguishes a frozen zero-rated export from a frozen unknown", () => {
    // 🔑 The reason all four columns are frozen rather than just the number: a
    // bare 0 cannot say which of these it is, and only one is a fact.
    const asUnknown = frozenTaxFallback(liveUnknownEmpty, {
      quoted_tax_total: null,
      quoted_tax_status: "unknown",
      quoted_tax_reason: "No tax rate is configured for ZZ.",
    })
    expect(asUnknown.total).toBeNull()

    const asExport = frozenTaxFallback(liveUnknownEmpty, frozenExport)
    expect(asExport.total).toBe(0)
    expect(asExport.status).not.toBe(asUnknown.status)
  })
})

/**
 * DDP — the partner absorbs destination duty (#1447).
 *
 * 🔴 The sentence this produces is a PROMISE, and the only one on the page that
 * software alone cannot keep: the shipment has to actually clear DDP. Shiprocket
 * reports `ddp_tag: false` on every lane today, so until a carrier supports it
 * this is honoured by hand. That is exactly why it is per-quote and frozen — a
 * global default would tell a buyer there is nothing to pay on a shipment
 * nobody arranged clearance for, and they would meet a customs bill anyway.
 */
describe("exportDisclosureReason — duties prepaid", () => {
  it("still says zero-rated, because the export treatment is unchanged", () => {
    // DDP is who pays the DESTINATION's duty. It has no bearing on whether the
    // origin zero-rates the export.
    expect(exportDisclosureReason("in", "de", true)).toMatch(/zero-rated/)
  })

  it("promises nothing further on delivery, and drops the buyer-pays wording", () => {
    const r = exportDisclosureReason("in", "de", true)
    expect(r).toMatch(/included in this price/i)
    expect(r).toMatch(/nothing further to pay on delivery/i)
    // The two must never coexist — a page saying both is a page saying neither.
    expect(r).not.toMatch(/payable by you/i)
    expect(r).not.toMatch(/NOT included/)
  })

  it("defaults to buyer-pays when the flag is absent", () => {
    // 🔑 The safe direction. An omitted flag must never be read as a promise:
    // over-warning costs a conversation, under-warning costs the customs bill.
    expect(exportDisclosureReason("in", "de")).toMatch(/payable by you/i)
    expect(exportDisclosureReason("in", "de", false)).toMatch(/payable by you/i)
  })
})

/**
 * `resolveQuoteTax` itself — the function, not just the pure helpers around it.
 *
 * ## Why this block exists
 *
 * Everything above tests the arithmetic and the wording; nothing tested the
 * function that decides what to ASK. Both halves of a prod blocker lived in
 * that gap, and both produced a plausible number rather than an error:
 *
 * 1. **Inclusivity was read off the region**, which on prod is `null` on every
 *    region while every calculated price reports `is_calculated_price_tax_inclusive:
 *    true`. So the quote added tax on top of a price that already contained it.
 * 2. **`product_type_id` was never sent to the tax module**, so a rate scoped
 *    by product type could not match and every quote quietly fell through to
 *    the region default — 5% quoted where the cart charged 18%.
 *
 * 🔑 Neither is visible downstream: both yield a confident total. They only
 * surfaced when a real buyer tried to accept and the cart disagreed.
 */
describe("resolveQuoteTax — what it asks the tax module", () => {
  const GOODS_RATE = { rate: 18, name: "IN GST 18", code: "IN-GST-OVER-2500" }

  const makeScope = (opts: { regionInclusive?: boolean | null } = {}) => {
    const getTaxLines = jest.fn(async (items: any[]) =>
      items.map((i) => ({
        line_item_id: i.shipping_option_id === undefined ? i.id : undefined,
        shipping_line_id: i.shipping_option_id !== undefined ? i.id : undefined,
        ...GOODS_RATE,
      }))
    )

    const scope = {
      resolve: (key: string) => {
        if (key === "tax") return { getTaxLines }
        return {
          graph: async () => ({
            data: [
              {
                id: "reg_1",
                automatic_taxes: true,
                is_tax_inclusive: opts.regionInclusive ?? null,
              },
            ],
          }),
        }
      },
    }

    return { scope, getTaxLines }
  }

  const input = {
    region_id: "reg_1",
    origin_country_code: "in",
    destination_country_code: "in",
    lines: [
      {
        variant_id: "var_a",
        product_id: "prod_a",
        product_type_id: "ptyp_textile",
        unit_amount: 18000,
        quantity: 5,
      },
    ],
    freight: null,
  }

  it("🔴 forwards product_type_id, or a type-scoped rate can never match", async () => {
    const { scope, getTaxLines } = makeScope()

    await resolveQuoteTax(scope as any, input as any)

    const [items] = getTaxLines.mock.calls[0] as any[]
    expect(items[0].product_type_id).toBe("ptyp_textile")
  })

  it("omits product_type_id entirely when there is none, rather than sending an empty one", async () => {
    const { scope, getTaxLines } = makeScope()

    await resolveQuoteTax(scope as any, {
      ...input,
      lines: [{ ...input.lines[0], product_type_id: null }],
    } as any)

    const [items] = getTaxLines.mock.calls[0] as any[]
    // An empty string matches nothing and reads exactly like "no rule matched",
    // which is the failure the field exists to end.
    expect("product_type_id" in items[0]).toBe(false)
  })

  /**
   * 🔑 The price is the fact; the region flag is a guess. On prod they
   * disagree, and the price is what the cart will actually charge against.
   */
  it("🔴 takes inclusivity from the PRICES, overriding a region that says otherwise", async () => {
    const { scope } = makeScope({ regionInclusive: null })

    const result = await resolveQuoteTax(scope as any, {
      ...input,
      prices_tax_inclusive: true,
    } as any)

    expect(result.inclusive).toBe(true)
    // Carved OUT of 90,000, not added on top of it: 90000 - 90000/1.18.
    expect(result.total).toBeCloseTo(13728.81, 1)
  })

  it("adds on top when the prices genuinely exclude tax", async () => {
    const { scope } = makeScope({ regionInclusive: null })

    const result = await resolveQuoteTax(scope as any, {
      ...input,
      prices_tax_inclusive: false,
    } as any)

    expect(result.inclusive).toBe(false)
    expect(result.total).toBeCloseTo(16200, 1)
  })

  /**
   * Absent means "not established", not "exclusive" — callers that price
   * nothing keep the old region-driven behaviour rather than silently
   * switching basis.
   */
  it("falls back to the region flag when the prices have no opinion", async () => {
    const { scope } = makeScope({ regionInclusive: true })

    const result = await resolveQuoteTax(scope as any, {
      ...input,
      prices_tax_inclusive: null,
    } as any)

    expect(result.inclusive).toBe(true)
  })
})

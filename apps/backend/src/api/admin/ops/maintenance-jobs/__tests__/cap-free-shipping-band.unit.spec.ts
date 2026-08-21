import { planFreeShippingCaps } from "../cap-free-shipping-band-job"

/**
 * International free shipping had no upper bound, so every bulk order cleared it.
 *
 * The assertions that matter are the ones about NOT acting. Domestic is
 * deliberately left open (founder call, 21 Aug 2026), so capping it would be a
 * defect, not an improvement — and INR appears in BOTH rate tables, so a lane
 * read from the option's name would cap the very tier that must stay open. A
 * hand-renamed zone (#954 renamed several) is enough to trigger that.
 */

const gte = (value: number) => ({
  attribute: "item_total",
  operator: "gte",
  value: String(value),
})
const lte = (value: number) => ({
  attribute: "item_total",
  operator: "lte",
  value: String(value),
})

const option = (over: any = {}) => ({
  id: "so_1",
  name: "Domestic Shipping · 68M3HY2V",
  price_type: "flat",
  prices: [
    { id: "price_base", amount: 99, currency_code: "inr", price_rules: [] },
    { id: "price_free", amount: 0, currency_code: "inr", price_rules: [gte(2999)] },
  ],
  ...over,
})

describe("planFreeShippingCaps", () => {
  it("leaves a DOMESTIC tier open, and says it did so on purpose", () => {
    // 🔴 The founder's call. ₹99-scale freight is absorbable, and a ceiling
    // here would start charging retail carts that ship free today. Reported
    // rather than silently passed over, so a reader can see it was examined.
    const { plan, skipped } = planFreeShippingCaps([option()])

    expect(plan).toHaveLength(0)
    expect(skipped[0].reason).toMatch(/deliberately uncapped/)
  })

  it("caps an INTERNATIONAL INR tier, from the threshold and not the name", () => {
    // 🔑 Same currency, same misleading name, different lane. Only the existing
    // threshold (25000, the international one) can tell them apart. Get this
    // wrong in the other direction and a domestic tier gets capped.
    const { plan } = planFreeShippingCaps([
      option({
        name: "Domestic Shipping · renamed-during-954",
        prices: [
          { id: "price_free", amount: 0, currency_code: "inr", price_rules: [gte(25000)] },
        ],
      }),
    ])

    expect(plan[0]).toMatchObject({ lane: "international", free_up_to: 30000 })
  })

  it("leaves a hand-set threshold alone rather than imposing a ceiling", () => {
    const { plan, skipped } = planFreeShippingCaps([
      option({
        prices: [
          { id: "price_free", amount: 0, currency_code: "inr", price_rules: [gte(7500)] },
        ],
      }),
    ])

    // Nobody chose 25000 for this row. Guessing is how an operator's deliberate
    // setting gets silently overwritten.
    expect(plan).toHaveLength(0)
    expect(skipped[0].reason).toMatch(/neither the domestic nor the international/)
  })

  it("is idempotent — a tier that already has a ceiling is skipped", () => {
    const { plan, skipped } = planFreeShippingCaps([
      option({
        name: "International Shipping · 68M3HY2V",
        prices: [
          {
            id: "price_free",
            amount: 0,
            currency_code: "eur",
            price_rules: [gte(300), lte(360)],
          },
        ],
      }),
    ])

    expect(plan).toHaveLength(0)
    // Not a skip either — nothing is wrong with it.
    expect(skipped).toHaveLength(0)
  })

  it("ignores the unconditional base price and calculated options", () => {
    const { plan } = planFreeShippingCaps([
      option({ price_type: "calculated" }),
      {
        id: "so_2",
        name: "Flat, no free tier",
        price_type: "flat",
        prices: [{ id: "p", amount: 99, currency_code: "inr", price_rules: [] }],
      },
    ])

    expect(plan).toHaveLength(0)
  })

  it("caps every currency on a multi-currency international option", () => {
    const { plan } = planFreeShippingCaps([
      {
        id: "so_intl",
        name: "International Shipping · 68M3HY2V",
        price_type: "flat",
        prices: [
          { id: "p_eur", amount: 0, currency_code: "eur", price_rules: [gte(300)] },
          { id: "p_usd", amount: 0, currency_code: "usd", price_rules: [gte(350)] },
          { id: "p_aud", amount: 0, currency_code: "aud", price_rules: [gte(450)] },
          { id: "p_idr", amount: 0, currency_code: "idr", price_rules: [gte(5000000)] },
        ],
      },
    ])

    expect(
      plan.map((p) => [p.currency_code, p.free_up_to])
    ).toEqual([
      ["eur", 360],
      ["usd", 420],
      ["aud", 540],
      ["idr", 6000000],
    ])
  })
})

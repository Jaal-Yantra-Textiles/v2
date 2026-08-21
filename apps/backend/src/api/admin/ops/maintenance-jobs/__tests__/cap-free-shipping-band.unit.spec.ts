import { planFreeShippingCaps } from "../cap-free-shipping-band-job"

/**
 * Free shipping had no upper bound, so every bulk order cleared it.
 *
 * The assertions that matter are the ones about telling the two lanes apart and
 * about NOT acting. INR appears in both rate tables; if the lane were read from
 * the option's name, a hand-renamed zone (#954 renamed several) would get the
 * wrong ceiling and nothing would ever look wrong.
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
  it("caps a domestic INR tier at the domestic ceiling", () => {
    const { plan } = planFreeShippingCaps([option()])

    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({
      price_id: "price_free",
      currency_code: "inr",
      free_above: 2999,
      free_up_to: 25000,
      lane: "domestic",
    })
  })

  it("caps an INTERNATIONAL INR tier higher, from the threshold and not the name", () => {
    // 🔑 Same currency, same misleading name, different lane. Only the existing
    // threshold (25000, the international one) can tell them apart — and
    // cross-border pricing steps at 5 kg, so the ceiling is a step higher.
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
        prices: [
          {
            id: "price_free",
            amount: 0,
            currency_code: "inr",
            price_rules: [gte(2999), lte(25000)],
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

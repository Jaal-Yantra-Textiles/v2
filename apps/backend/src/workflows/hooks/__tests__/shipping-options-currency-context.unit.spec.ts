/**
 * The shipping-options rule context must carry the cart's currency.
 *
 * A calculated option has no price rows, so nothing confines it to a lane the
 * way a missing flat price confines a flat option. A `cart_currency_code` rule
 * is the only gate — and a rule naming a key the context does not publish does
 * not error, it simply matches nothing, on every cart, forever. So the one
 * thing worth asserting is that the key is REALLY in the returned context, and
 * on every branch the hook can take.
 */
jest.mock("@medusajs/medusa/core-flows", () => ({
  listShippingOptionsForCartWorkflow: { hooks: { setShippingOptionsContext: jest.fn() } },
  listShippingOptionsForCartWithPricingWorkflow: {
    hooks: { setShippingOptionsContext: jest.fn() },
  },
}))

import {
  listShippingOptionsForCartWorkflow,
  listShippingOptionsForCartWithPricingWorkflow,
} from "@medusajs/medusa/core-flows"

import "../quote-shipping-options-context"

/** The handler both workflows were registered with. */
const handler = (): any =>
  (listShippingOptionsForCartWorkflow.hooks.setShippingOptionsContext as jest.Mock)
    .mock.calls[0][0]

/**
 * The hook returns a `StepResponse`; core reads the value through
 * `getResult()`, which is the `output` side of it. Reading the wrong side is
 * how this file's subject once threw its own answer away.
 */
const run = async (
  cart: any,
  container: any = { resolve: () => ({ listPartnerQuotes: async () => [] }) }
) => {
  const res: any = await handler()({ cart }, { container })
  return res?.output ?? res
}

describe("setShippingOptionsContext — cart_currency_code", () => {
  it("registers on BOTH list workflows", () => {
    // Wiring only one produces a cart that can be shown an option and is then
    // told the option is invalid.
    expect(
      listShippingOptionsForCartWorkflow.hooks.setShippingOptionsContext
    ).toHaveBeenCalled()
    expect(
      listShippingOptionsForCartWithPricingWorkflow.hooks.setShippingOptionsContext
    ).toHaveBeenCalled()
  })

  it("publishes the cart's currency, lower-cased", async () => {
    const out = await run({ id: "cart_1", currency_code: "GBP" })
    expect(out.cart_currency_code).toBe("gbp")
  })

  it("still publishes the currency when the quote lookup THROWS", async () => {
    // A failed quote lookup says nothing about the currency. Dropping the key
    // here would hide every currency-gated option on an unrelated error.
    const container = {
      resolve: () => ({
        listPartnerQuotes: async () => {
          throw new Error("db gone")
        },
      }),
    }
    const out = await run({ id: "cart_1", currency_code: "aed" }, container)
    expect(out.cart_currency_code).toBe("aed")
    expect(out.quote_id).toBe("none")
  })

  it("publishes the currency even with no cart id", async () => {
    const out = await run({ currency_code: "cad" })
    expect(out.cart_currency_code).toBe("cad")
  })

  it("falls back to 'none' rather than omitting the key", async () => {
    // An ABSENT key and a key that matches nothing are different failures: an
    // absent one is stringified to "undefined" and would make a `ne` rule
    // match; "none" is simply a currency that does not exist.
    const out = await run({ id: "cart_1" })
    expect(out.cart_currency_code).toBe("none")
  })

  it("still resolves the quote id — the currency did not displace it", async () => {
    const container = {
      resolve: () => ({ listPartnerQuotes: async () => [{ id: "quo_7" }] }),
    }
    const out = await run({ id: "cart_1", currency_code: "eur" }, container)
    expect(out).toEqual({ quote_id: "quo_7", cart_currency_code: "eur" })
  })
})

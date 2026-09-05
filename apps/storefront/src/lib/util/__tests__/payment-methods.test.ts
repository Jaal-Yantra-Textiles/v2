import { describe, expect, it } from "vitest"

import {
  foldPaymentMethods,
  shouldShowMethodChooser,
} from "../payment-methods"

const STRIPE = { id: "pp_stripe_stripe" }
const CONNECT = { id: "pp_stripe-connect_stripe-connect" }
const PAYU = { id: "pp_payu_payu" }
const IDEAL = { id: "pp_stripe-ideal_stripe" }

describe("foldPaymentMethods", () => {
  it("leaves a region with a single provider alone", () => {
    expect(foldPaymentMethods([STRIPE]).map((m) => m.id)).toEqual([
      "pp_stripe_stripe",
    ])
  })

  it("folds the two generic Stripe providers into one entry", () => {
    // Europe carries both; they differ only in where the money settles, and
    // #985 says the buyer never sees that split.
    expect(foldPaymentMethods([STRIPE, CONNECT]).map((m) => m.id)).toEqual([
      "pp_stripe_stripe",
    ])
  })

  it("keeps the provider the cart is already paying through", () => {
    // 🔴 The fold must never move an in-flight payment between settlement
    // routes. If a session exists on Connect, Connect survives the fold.
    expect(
      foldPaymentMethods([STRIPE, CONNECT], "pp_stripe-connect_stripe-connect")
        .map((m) => m.id)
    ).toEqual(["pp_stripe-connect_stripe-connect"])
  })

  it("holds the folded entry in the position of the first Stripe provider", () => {
    const folded = foldPaymentMethods(
      [PAYU, STRIPE, CONNECT],
      "pp_stripe-connect_stripe-connect"
    )
    expect(folded.map((m) => m.id)).toEqual([
      "pp_payu_payu",
      "pp_stripe-connect_stripe-connect",
    ])
  })

  it("does not fold the method-specific Stripe providers", () => {
    // iDeal and Bancontact are real, distinguishable choices to a shopper —
    // unlike "Stripe", which is a processor.
    expect(foldPaymentMethods([STRIPE, IDEAL]).map((m) => m.id)).toEqual([
      "pp_stripe_stripe",
      "pp_stripe-ideal_stripe",
    ])
  })

  it("keeps non-Stripe providers untouched", () => {
    expect(foldPaymentMethods([PAYU, STRIPE]).map((m) => m.id)).toEqual([
      "pp_payu_payu",
      "pp_stripe_stripe",
    ])
  })

  it("falls back to the raw id when nothing names the provider", () => {
    expect(foldPaymentMethods([{ id: "pp_unknown_x" }])[0].title).toBe(
      "pp_unknown_x"
    )
  })
})

describe("shouldShowMethodChooser", () => {
  it("hides the chooser when the region offers one way to pay", () => {
    expect(shouldShowMethodChooser(foldPaymentMethods([STRIPE]))).toBe(false)
    // The whole point: Europe's two "Stripe" tiles are one choice, not two.
    expect(shouldShowMethodChooser(foldPaymentMethods([STRIPE, CONNECT]))).toBe(
      false
    )
  })

  it("shows it when there is a real choice", () => {
    expect(shouldShowMethodChooser(foldPaymentMethods([PAYU, STRIPE]))).toBe(
      true
    )
  })

  it("hides it when the region offers nothing", () => {
    expect(shouldShowMethodChooser([])).toBe(false)
  })
})

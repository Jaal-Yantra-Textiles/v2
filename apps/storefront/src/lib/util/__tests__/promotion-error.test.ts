import { describe, expect, it } from "vitest"

import {
  describePromotionFailure,
  isMissingCustomerPromotionError,
  PROMOTION_REQUIRES_SIGN_IN_MESSAGE,
} from "../promotion-error"

/**
 * 🔴 A guest applying a one-per-customer code was shown the promotion module's
 * own internal string, Medusa's typo and all:
 *
 *   Attribute value for "customer_id" is required by promotion campaing budget
 *
 * The code was valid. The cart just had no buyer on it. See #2194.
 */
describe("isMissingCustomerPromotionError", () => {
  const LIVE_MESSAGE =
    'Attribute value for "customer_id" is required by promotion campaing budget'

  it("recognises the string Medusa actually throws today", () => {
    expect(isMissingCustomerPromotionError(new Error(LIVE_MESSAGE))).toBe(true)
    // The route handler hands us a serialized object, not an Error.
    expect(isMissingCustomerPromotionError({ message: LIVE_MESSAGE })).toBe(true)
  })

  it("🔴 still recognises it once Medusa fixes 'campaing'", () => {
    /*
     * THE CASE THIS TEST EXISTS FOR. Keying the matcher to the typo would work
     * perfectly until an upgrade corrected the spelling, and then fail open —
     * the raw string back in front of buyers, with nothing red anywhere.
     */
    expect(
      isMissingCustomerPromotionError(
        new Error(
          'Attribute value for "customer_id" is required by promotion campaign budget'
        )
      )
    ).toBe(true)
  })

  it("leaves other budget failures alone", () => {
    // An exhausted spend budget is a real refusal, not missing identity.
    expect(
      isMissingCustomerPromotionError(
        new Error("Promotion campaign budget has been exceeded")
      )
    ).toBe(false)
    expect(
      isMissingCustomerPromotionError(
        new Error("Promotion with code FRIENDS does not exist")
      )
    ).toBe(false)
    expect(isMissingCustomerPromotionError(undefined)).toBe(false)
    expect(isMissingCustomerPromotionError(null)).toBe(false)
    expect(isMissingCustomerPromotionError({})).toBe(false)
  })
})

describe("describePromotionFailure", () => {
  it("asks a guest to sign in instead of quoting the module", () => {
    const failure = describePromotionFailure({
      message:
        'Attribute value for "customer_id" is required by promotion campaing budget',
    })

    expect(failure.requiresSignIn).toBe(true)
    expect(failure.message).toBe(PROMOTION_REQUIRES_SIGN_IN_MESSAGE)
    expect(failure.message).not.toContain("customer_id")
  })

  it("keeps a readable server message rather than flattening it", () => {
    // 🔴 A wrong code must not read as "sign in" — the shopper would go and do
    // it, come back, and be refused again by the same bad code.
    const failure = describePromotionFailure({
      message: "Promotion with code NOPE does not exist",
    })

    expect(failure).toEqual({
      message: "Promotion with code NOPE does not exist",
      requiresSignIn: false,
    })
  })

  it("falls back when there is no message at all", () => {
    expect(describePromotionFailure({}, "Failed to apply promotions")).toEqual({
      message: "Failed to apply promotions",
      requiresSignIn: false,
    })
  })
})

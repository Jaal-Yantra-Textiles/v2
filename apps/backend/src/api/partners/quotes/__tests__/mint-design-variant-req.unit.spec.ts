/**
 * 🔴 The route reads `req.validatedBody`, which ONLY
 * `validateAndTransformBody` populates. Both mint routes were registered
 * without it, so that read was always `undefined`, the client's JSON sat in
 * `req.body` unread, and every made-to-order pick answered:
 *
 *   400 "currency_code is required — the variant has to be listed in the
 *        currency the quote is denominated in."
 *
 * The message was true about the requirement and wrong about the cause, which
 * sends you looking at the form for a field the form was sending correctly.
 *
 * These cases pin the schema. They cannot pin the WIRING — a schema that is
 * never referenced in `middlewares.ts` would pass every test here while the
 * route reads nothing, which is exactly the state this fixes. The middleware
 * entry is the other half and has to be read, not assumed.
 */
import { MintDesignVariantReq } from "../validators"

describe("MintDesignVariantReq", () => {
  it("accepts what the pickers actually post", () => {
    const parsed = MintDesignVariantReq.parse({ currency_code: "inr" })
    expect(parsed.currency_code).toBe("inr")
  })

  it("carries an optional markup for ops", () => {
    expect(
      MintDesignVariantReq.parse({ currency_code: "usd", markup_percent: 35 })
        .markup_percent
    ).toBe(35)
  })

  it("refuses a missing currency, with the words the UI shows", () => {
    const result = MintDesignVariantReq.safeParse({})
    expect(result.success).toBe(false)
    if (result.success) throw new Error("unreachable")
    expect(JSON.stringify(result.error.issues)).toContain("currency_code is required")
  })

  it("refuses an EMPTY currency, which is what an unfinished form sends", () => {
    // The admin form's `currency_code` starts as "" and is set on the buyer
    // step. An empty string is not a currency and must not reach the mint.
    expect(MintDesignVariantReq.safeParse({ currency_code: "" }).success).toBe(false)
  })

  it("refuses a negative markup", () => {
    expect(
      MintDesignVariantReq.safeParse({ currency_code: "inr", markup_percent: -10 })
        .success
    ).toBe(false)
  })

  it("allows a zero markup — quoting at cost is a choice, not an error", () => {
    expect(
      MintDesignVariantReq.safeParse({ currency_code: "inr", markup_percent: 0 })
        .success
    ).toBe(true)
  })
})

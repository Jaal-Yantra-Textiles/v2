import { AdminMintQuoteReq } from "../../../admin/quotes/validators"
import { PartnerMintQuoteReq, QuoteReadinessReq } from "../validators"

/**
 * The deposit share has to survive validation to exist at all (#1439 S11).
 *
 * 🔑 `zodValidator` forces `.strict()` on request bodies, so a field the schema
 * does not name does not merely get ignored — it never reaches the workflow.
 * The wizard would show the number the partner typed, the quote would freeze
 * nothing, and the buyer would be asked for the default 30% at acceptance. The
 * failure is silent at every step, which is why it is worth a test rather than
 * a glance at the schema.
 */

const body = (over: Record<string, any> = {}) => ({
  buyer_email: "buyer@example.com",
  lines: [{ variant_id: "variant_1", quantity: 10 }],
  destination_country_code: "in",
  currency_code: "inr",
  ...over,
})

describe("deposit_pct on the mint schemas", () => {
  it("survives the partner mint schema", () => {
    const parsed = PartnerMintQuoteReq.parse(body({ deposit_pct: 45 }))
    expect(parsed.deposit_pct).toBe(45)
  })

  it("survives the ADMIN mint schema, which extends the partner shape", () => {
    // The admin twin extends the shape rather than restating it, so a field
    // added to one must appear on the other for free. This is the assertion
    // that catches the day someone restates it.
    const parsed = AdminMintQuoteReq.parse(
      body({ deposit_pct: 45, partner_id: "partner_1" })
    )
    expect(parsed.deposit_pct).toBe(45)
  })

  it("🔑 keeps 0 as 0 rather than dropping it as falsy", () => {
    // A partner taking nothing up front means it. If this came back undefined,
    // the backend's resolver would read "nobody named terms" and apply 30%.
    const parsed = PartnerMintQuoteReq.parse(body({ deposit_pct: 0 }))
    expect(parsed.deposit_pct).toBe(0)
  })

  it("accepts the boundaries and refuses what is outside them", () => {
    expect(PartnerMintQuoteReq.parse(body({ deposit_pct: 100 })).deposit_pct).toBe(100)
    expect(() => PartnerMintQuoteReq.parse(body({ deposit_pct: 101 }))).toThrow()
    expect(() => PartnerMintQuoteReq.parse(body({ deposit_pct: -1 }))).toThrow()
  })

  it("is optional — most quotes name no terms", () => {
    const parsed = PartnerMintQuoteReq.parse(body())
    expect(parsed.deposit_pct).toBeUndefined()
  })

  it("is NOT part of the readiness preflight", () => {
    // A dry run prices a basket; how it will be paid for changes none of those
    // numbers. Omitted for the same reason the buyer's identity is.
    // Asserted through BEHAVIOUR rather than by reaching into the schema's
    // internals: a refined schema's shape is not reachable the same way across
    // zod versions, and a test that breaks on an upgrade teaches nothing.
    const parsed: any = QuoteReadinessReq.parse(
      body({ deposit_pct: 45, destination_country_code: "in" })
    )
    expect(parsed.deposit_pct).toBeUndefined()
  })
})

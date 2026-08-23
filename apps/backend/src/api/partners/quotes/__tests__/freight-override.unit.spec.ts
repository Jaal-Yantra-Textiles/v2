import { AdminMintQuoteReq } from "../../../admin/quotes/validators"
import { PartnerMintQuoteReq, QuoteReadinessReq } from "../validators"

/**
 * Freight named by hand has to reach the mint, and the preflight has to agree
 * with it (#1439 S12).
 *
 * 🔑 `zodValidator` forces `.strict()`, so a field the schema does not name
 * never reaches the workflow. For this field that failure is expensive and
 * silent: the wizard would show the freight the partner typed, the quote would
 * freeze the flat stored tier — 35 EUR whether the consignment is 5.5 kg or 22
 * kg — and the difference would come out of margin with nobody told.
 */

const body = (over: Record<string, any> = {}) => ({
  buyer_email: "buyer@example.com",
  lines: [{ variant_id: "variant_1", quantity: 200 }],
  destination_country_code: "de",
  currency_code: "eur",
  ...over,
})

describe("freight_override_amount on the mint schemas", () => {
  it("survives the partner mint schema, with its basis", () => {
    const parsed = PartnerMintQuoteReq.parse(
      body({
        freight_override_amount: 250,
        freight_basis: "DHL rate card 12 Aug, 22 kg to DE",
      })
    )
    expect(parsed.freight_override_amount).toBe(250)
    expect(parsed.freight_basis).toBe("DHL rate card 12 Aug, 22 kg to DE")
  })

  it("survives the ADMIN mint schema, which extends the partner shape", () => {
    const parsed = AdminMintQuoteReq.parse(
      body({ freight_override_amount: 250, partner_id: "partner_1" })
    )
    expect(parsed.freight_override_amount).toBe(250)
  })

  it("🔴 refuses a zero — free international freight is not a typo away", () => {
    // This system has already shipped bulk orders free once, off a rule-gated
    // `0 INR` row (#1430). A zero in a numeric field must not be able to do it
    // again by accident.
    expect(() =>
      PartnerMintQuoteReq.parse(body({ freight_override_amount: 0 }))
    ).toThrow()
    expect(() =>
      PartnerMintQuoteReq.parse(body({ freight_override_amount: -10 }))
    ).toThrow()
  })

  it("is optional — a rateable lane should use its rate", () => {
    const parsed = PartnerMintQuoteReq.parse(body())
    expect(parsed.freight_override_amount).toBeUndefined()
  })

  it("🔑 REACHES the readiness preflight, unlike the deposit", () => {
    // It decides whether the lane has to be rateable at all, so a preflight
    // blind to it would refuse exactly the cross-border quotes an override
    // exists to unblock — and then the mint would accept them. A preflight that
    // disagrees with the mint is worse than no preflight.
    const parsed: any = QuoteReadinessReq.parse(
      body({ freight_override_amount: 250 })
    )
    expect(parsed.freight_override_amount).toBe(250)
  })

  it("drops only the BASIS from the preflight — a dry run freezes nothing", () => {
    const parsed: any = QuoteReadinessReq.parse(
      body({ freight_override_amount: 250, freight_basis: "DHL rate card" })
    )
    expect(parsed.freight_basis).toBeUndefined()
  })
})

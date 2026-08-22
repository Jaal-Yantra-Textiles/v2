import { AdminMintQuoteReq } from "../../../admin/quotes/validators"
import { PartnerMintQuoteReq, QuoteReadinessReq } from "../validators"

/**
 * The DDP promise may not travel without its numbers (#1447).
 *
 * 🔴 `duties_prepaid` used to be accepted alone. It flips the buyer's page to
 * "nothing further to pay on delivery" and adds nothing to the price, so the
 * charges are absorbed out of margin by an amount nobody computed — and the
 * quote carries no record that anything was ever owed.
 *
 * 🔴 And there are THREE of them. On DHL's own numbers for a 70,000 INR
 * consignment to NL, the duty is 6,143 and the import VAT is 17,416 — funding
 * only the duty under-writes the promise by most of its value.
 *
 * All FOUR schemas are asserted here on purpose. The admin twin extends the
 * shape and the readiness preflight omits from it; `.extend()` and `.omit()` on
 * an already-refined schema drop cross-field rules silently, so a passing
 * partner-only test would prove nothing about the surface an admin mints from.
 */
const body = (over: Record<string, any> = {}) => ({
  buyer_email: "buyer@example.com",
  lines: [{ variant_id: "var_a", quantity: 500 }],
  destination_country_code: "de",
  currency_code: "eur",
  ...over,
})

const readiness = (over: Record<string, any> = {}) => {
  const { buyer_email, ...rest } = body(over)
  return rest
}

describe("the DDP undertaking needs a duty figure", () => {
  it("refuses duties_prepaid with no duty answer at all", () => {
    const parsed = PartnerMintQuoteReq.safeParse(
      body({
        duties_prepaid: true,
        import_tax_rate_percent: 21,
        duty_basis: "EU, NL VAT",
      })
    )

    expect(parsed.success).toBe(false)
    expect(JSON.stringify(parsed.error?.issues)).toContain("duty")
  })

  it("🔴 refuses a DDP quote that funds the duty and forgets the import tax", () => {
    // The whole point of the split. 8% duty is the small half; the 21% VAT on
    // (goods + freight + duty) is the big one, and a promise funded at a
    // quarter of its value fails silently, on our side of the ledger.
    const parsed = PartnerMintQuoteReq.safeParse(
      body({
        duties_prepaid: true,
        duty_rate_percent: 8,
        duty_basis: "EU 8% ad valorem, HS 6304.92",
      })
    )

    expect(parsed.success).toBe(false)
    expect(JSON.stringify(parsed.error?.issues)).toContain("import_tax")
  })

  it("refuses a DDP quote with figures and no basis", () => {
    // A bare 0 cannot say whether it means "checked, AI-ECTA, nil" or "left
    // blank", and the person who meets the customs invoice is not the one who
    // typed it.
    const parsed = PartnerMintQuoteReq.safeParse(
      body({ duties_prepaid: true, duty_total: 0, import_tax_total: 0 })
    )

    expect(parsed.success).toBe(false)
    expect(JSON.stringify(parsed.error?.issues)).toContain("duty_basis")
  })

  it("accepts nil charges stated with their basis", () => {
    const parsed = PartnerMintQuoteReq.safeParse(
      body({
        destination_country_code: "au",
        duties_prepaid: true,
        duty_total: 0,
        import_tax_total: 0,
        duty_basis: "AI-ECTA — Indian textiles enter AU duty-free",
      })
    )

    expect(parsed.success).toBe(true)
  })

  it("accepts the rate form, which is the normal one", () => {
    const parsed = PartnerMintQuoteReq.safeParse(
      body({
        duties_prepaid: true,
        duty_rate_percent: 8,
        import_tax_rate_percent: 21,
        ddp_fee_total: 1_981.57,
        duty_basis: "EU: 8% duty, 21% NL VAT, DHL DTP fee",
      })
    )

    expect(parsed.success).toBe(true)
  })

  it("refuses a rate AND an amount for the same charge", () => {
    // Ranking them would mean "which one wins" has an answer. It should not —
    // the same rule the per-line discount/override pair follows.
    const parsed = PartnerMintQuoteReq.safeParse(
      body({
        duties_prepaid: true,
        duty_rate_percent: 8,
        duty_total: 6_143.36,
        import_tax_rate_percent: 21,
        duty_basis: "both, by mistake",
      })
    )

    expect(parsed.success).toBe(false)
  })

  it("refuses DDP figures on a quote that is not DDP", () => {
    expect(PartnerMintQuoteReq.safeParse(body({ duty_total: 12_000 })).success).toBe(
      false
    )
    expect(
      PartnerMintQuoteReq.safeParse(body({ import_tax_rate_percent: 21 })).success
    ).toBe(false)
    expect(
      PartnerMintQuoteReq.safeParse(body({ ddp_fee_total: 1_981.57 })).success
    ).toBe(false)
  })

  it("leaves an ordinary quote alone", () => {
    expect(PartnerMintQuoteReq.safeParse(body()).success).toBe(true)
  })

  it("holds on the ADMIN mint, which extends the shape", () => {
    expect(
      AdminMintQuoteReq.safeParse(
        body({ partner_id: "part_1", duties_prepaid: true })
      ).success
    ).toBe(false)
    expect(
      AdminMintQuoteReq.safeParse(
        body({
          partner_id: "part_1",
          duties_prepaid: true,
          duty_rate_percent: 8,
          import_tax_rate_percent: 21,
          duty_basis: "EU: 8% duty, 21% NL VAT, HS 6304.92",
        })
      ).success
    ).toBe(true)
  })

  it("holds on the readiness preflight, which omits from the shape", () => {
    // A preflight that accepted what the mint rejects tells a partner their
    // quote is ready and then refuses it.
    expect(
      QuoteReadinessReq.safeParse(readiness({ duties_prepaid: true })).success
    ).toBe(false)
  })
})

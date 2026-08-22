import { AdminMintQuoteReq } from "../../../admin/quotes/validators"
import { PartnerMintQuoteReq, QuoteReadinessReq } from "../validators"

/**
 * The DDP promise may not travel without its number (#1447).
 *
 * 🔴 `duties_prepaid` used to be accepted alone. It flips the buyer's page to
 * "nothing further to pay on delivery" and adds nothing to the price, so the
 * duty is absorbed out of margin by an amount nobody computed — and the quote
 * carries no record that a figure was ever owed.
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
  it("refuses duties_prepaid with no amount", () => {
    const parsed = PartnerMintQuoteReq.safeParse(
      body({ duties_prepaid: true, duty_basis: "EU 12% ad valorem" })
    )

    expect(parsed.success).toBe(false)
    expect(JSON.stringify(parsed.error?.issues)).toContain("duty_total")
  })

  it("refuses duties_prepaid with an amount and no basis", () => {
    // A bare 0 cannot say whether it means "checked, AI-ECTA, nil" or "left
    // blank", and the person who meets the customs invoice is not the one who
    // typed it.
    const parsed = PartnerMintQuoteReq.safeParse(
      body({ duties_prepaid: true, duty_total: 0 })
    )

    expect(parsed.success).toBe(false)
    expect(JSON.stringify(parsed.error?.issues)).toContain("duty_basis")
  })

  it("accepts a nil duty stated with its basis", () => {
    const parsed = PartnerMintQuoteReq.safeParse(
      body({
        destination_country_code: "au",
        duties_prepaid: true,
        duty_total: 0,
        duty_basis: "AI-ECTA — Indian textiles enter AU duty-free",
      })
    )

    expect(parsed.success).toBe(true)
  })

  it("refuses a duty amount on a quote that is not DDP", () => {
    const parsed = PartnerMintQuoteReq.safeParse(body({ duty_total: 12_000 }))

    expect(parsed.success).toBe(false)
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
          duty_total: 12_000,
          duty_basis: "EU 12% ad valorem, HS 6304.92",
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

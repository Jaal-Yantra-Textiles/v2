import { describeIntlPrereqError } from "../client"

/**
 * #1118 — the intl-prerequisites gate turns Shiprocket's opaque KYC / bank /
 * pickup rejections into actionable admin guidance. These assert the keyword
 * matching on representative Shiprocket wording, and that unrelated errors pass
 * through untouched (null → caller rethrows the original).
 */
describe("describeIntlPrereqError (#1118)", () => {
  it("detects an unverified-KYC rejection", () => {
    const g = describeIntlPrereqError({
      message: "Your KYC is not verified. Please complete KYC to ship internationally.",
    })
    expect(g?.reason).toBe("kyc")
    expect(g?.message).toMatch(/KYC/i)
    expect(g?.message).toMatch(/retry/i)
  })

  it("detects missing settlement bank details", () => {
    const g = describeIntlPrereqError({
      message: "Bank account details are not updated for your account.",
    })
    expect(g?.reason).toBe("bank_details")
    expect(g?.message).toMatch(/bank details/i)
  })

  it("detects a pickup not enabled for international shipping", () => {
    const g = describeIntlPrereqError({
      message: "Pickup location is not enabled for international shipping.",
    })
    expect(g?.reason).toBe("pickup_not_intl")
    expect(g?.message).toMatch(/pickup/i)
  })

  it("prefers the pickup reason when wording mentions both pickup and international", () => {
    // Pickup-not-intl wording often also says "international" — make sure it
    // doesn't fall through to a less-specific match.
    const g = describeIntlPrereqError({
      message: "This pickup address is not allowed for international orders.",
    })
    expect(g?.reason).toBe("pickup_not_intl")
  })

  it("reads messages out of a Shiprocket field-error bag", () => {
    const g = describeIntlPrereqError({
      fieldErrors: { kyc_status: ["KYC pending, cannot create international shipment"] },
    })
    expect(g?.reason).toBe("kyc")
  })

  it("returns null for an unrelated error (caller rethrows untouched)", () => {
    expect(
      describeIntlPrereqError({ message: "HSN code is required for international shipments" })
    ).toBeNull()
    expect(describeIntlPrereqError({ message: "Invalid pincode" })).toBeNull()
    expect(describeIntlPrereqError({})).toBeNull()
  })

  it("does not treat a bare 'bank' mention without detail/account/settlement as a gate", () => {
    // Avoid false positives on incidental wording.
    expect(describeIntlPrereqError({ message: "riverbank warehouse closed" })).toBeNull()
  })
})

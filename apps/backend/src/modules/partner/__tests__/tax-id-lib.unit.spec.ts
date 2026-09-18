import {
  getPlatformTaxIds,
  normalizeBrand,
  resolvePartnerTaxId,
  validateTaxIdentity,
} from "../tax-id-lib"

describe("tax-id-lib (issue #348)", () => {
  describe("normalizeBrand", () => {
    it("returns the default brand when missing/empty/whitespace", () => {
      expect(normalizeBrand(undefined)).toBe("JYT")
      expect(normalizeBrand(null)).toBe("JYT")
      expect(normalizeBrand("")).toBe("JYT")
      expect(normalizeBrand("   ")).toBe("JYT")
    })

    it("is case-insensitive and trims", () => {
      expect(normalizeBrand("kht")).toBe("KHT")
      expect(normalizeBrand("  Kht  ")).toBe("KHT")
      expect(normalizeBrand("JYT")).toBe("JYT")
    })

    it("falls back to default for unrecognised brands", () => {
      expect(normalizeBrand("ACME")).toBe("JYT")
      expect(normalizeBrand("xyz", "KHT")).toBe("KHT")
    })

    it("honours a custom default brand", () => {
      expect(normalizeBrand(null, "KHT")).toBe("KHT")
    })
  })

  describe("resolvePartnerTaxId", () => {
    const platformTaxIds = { JYT: "JYT-GST-111", KHT: "KHT-GST-222" }

    it("uses the partner's own tax ID when present (source=partner)", () => {
      const res = resolvePartnerTaxId({
        partnerTaxId: "PARTNER-GST-999",
        partnerTaxIdType: "GSTIN",
        brand: "JYT",
        platformTaxIds,
      })
      expect(res).toEqual({
        taxId: "PARTNER-GST-999",
        source: "partner",
        brand: "JYT",
        taxIdType: "GSTIN",
      })
    })

    it("trims the partner tax ID", () => {
      const res = resolvePartnerTaxId({
        partnerTaxId: "  PARTNER-GST-999  ",
        platformTaxIds,
      })
      expect(res.taxId).toBe("PARTNER-GST-999")
      expect(res.source).toBe("partner")
    })

    it("falls back to the platform tax ID for the brand when partner has none", () => {
      const res = resolvePartnerTaxId({
        partnerTaxId: null,
        brand: "KHT",
        platformTaxIds,
      })
      expect(res).toEqual({
        taxId: "KHT-GST-222",
        source: "platform",
        brand: "KHT",
        taxIdType: null,
      })
    })

    it("treats empty / whitespace partner tax ID as missing", () => {
      expect(resolvePartnerTaxId({ partnerTaxId: "", platformTaxIds }).source).toBe(
        "platform"
      )
      expect(
        resolvePartnerTaxId({ partnerTaxId: "   ", platformTaxIds }).source
      ).toBe("platform")
    })

    it("resolves the platform fallback against the default brand when brand missing", () => {
      const res = resolvePartnerTaxId({ partnerTaxId: null, platformTaxIds })
      expect(res.brand).toBe("JYT")
      expect(res.taxId).toBe("JYT-GST-111")
      expect(res.source).toBe("platform")
    })

    it("returns source=none when neither partner nor platform have an ID", () => {
      const res = resolvePartnerTaxId({
        partnerTaxId: null,
        brand: "JYT",
        platformTaxIds: {},
      })
      expect(res).toEqual({
        taxId: null,
        source: "none",
        brand: "JYT",
        taxIdType: null,
      })
    })

    it("returns source=none when platformTaxIds is omitted and partner has none", () => {
      const res = resolvePartnerTaxId({ partnerTaxId: null })
      expect(res.source).toBe("none")
      expect(res.taxId).toBeNull()
    })

    it("does not leak the partner tax-ID type onto a platform fallback", () => {
      const res = resolvePartnerTaxId({
        partnerTaxId: "",
        partnerTaxIdType: "GSTIN",
        platformTaxIds,
      })
      expect(res.source).toBe("platform")
      expect(res.taxIdType).toBeNull()
    })

    it("honours an unrecognised brand by mapping to defaultBrand for fallback", () => {
      const res = resolvePartnerTaxId({
        partnerTaxId: null,
        brand: "UNKNOWN",
        defaultBrand: "KHT",
        platformTaxIds,
      })
      expect(res.brand).toBe("KHT")
      expect(res.taxId).toBe("KHT-GST-222")
    })
  })

  describe("getPlatformTaxIds", () => {
    it("reads brand tax IDs from the injected env", () => {
      const ids = getPlatformTaxIds({
        JYT_PLATFORM_TAX_ID: "JYT-ENV-1",
        KHT_PLATFORM_TAX_ID: "KHT-ENV-2",
      })
      expect(ids).toEqual({ JYT: "JYT-ENV-1", KHT: "KHT-ENV-2" })
    })

    it("returns nulls for missing / blank env values", () => {
      expect(getPlatformTaxIds({})).toEqual({ JYT: null, KHT: null })
      expect(
        getPlatformTaxIds({ JYT_PLATFORM_TAX_ID: "   ", KHT_PLATFORM_TAX_ID: "" })
      ).toEqual({ JYT: null, KHT: null })
    })
  })
})

/**
 * validateTaxIdentity — the check on the way IN.
 *
 * Found reviewing #2120: `PUT /admin/partners/:id` registers no body validator
 * and spreads its body straight into the update, and #2120 pointed `tax_id` at
 * it. That value lands on Delhivery's `seller_gst_tin`, Shiprocket's `gstin`
 * and invoices — so a malformed one is caught by a carrier rejecting a
 * shipment, or not caught at all.
 *
 * 🔴 These assert a FORMAT check. A well-formed GSTIN can belong to nobody.
 * Nothing here should ever be described as verifying a registration.
 */
describe("validateTaxIdentity", () => {
  const ok = (v: any) => {
    expect(v.ok).toBe(true)
    return v
  }
  const bad = (v: any) => {
    expect(v.ok).toBe(false)
    return v
  }

  it("accepts the real GSTIN we recorded for Ksaman Naturals", () => {
    const v = ok(validateTaxIdentity({ tax_id: "21AALCK3037B1Z4", tax_id_type: "GSTIN" }))
    expect(v.tax_id).toBe("21AALCK3037B1Z4")
    expect(v.tax_id_type).toBe("GSTIN")
  })

  it("normalises case and whitespace, so one registration cannot become two", () => {
    const v = ok(validateTaxIdentity({ tax_id: "  21aalck3037b1z4 ", tax_id_type: " gstin " }))
    expect(v.tax_id).toBe("21AALCK3037B1Z4")
    expect(v.tax_id_type).toBe("GSTIN")
  })

  it("🔴 refuses a number with no type — nothing says what it is", () => {
    const v = bad(validateTaxIdentity({ tax_id: "21AALCK3037B1Z4" }))
    expect(v.error).toMatch(/tax_id_type is required/)
  })

  it("🔴 refuses a GSTIN of the wrong length", () => {
    expect(bad(validateTaxIdentity({ tax_id: "21AALCK3037B1Z", tax_id_type: "GSTIN" })).error).toMatch(/not a valid GSTIN/)
    expect(bad(validateTaxIdentity({ tax_id: "21AALCK3037B1Z44", tax_id_type: "GSTIN" })).error).toMatch(/not a valid GSTIN/)
  })

  it("🔴 refuses a GSTIN without 'Z' in position 14", () => {
    bad(validateTaxIdentity({ tax_id: "21AALCK3037B1X4", tax_id_type: "GSTIN" }))
  })

  it("🔴 refuses a GSTIN whose state code is not digits", () => {
    bad(validateTaxIdentity({ tax_id: "2AAALCK3037B1Z4", tax_id_type: "GSTIN" }))
  })

  it("refuses free text pretending to be a GSTIN", () => {
    bad(validateTaxIdentity({ tax_id: "applied for", tax_id_type: "GSTIN" }))
    bad(validateTaxIdentity({ tax_id: "N/A", tax_id_type: "GSTIN" }))
  })

  it("validates a PAN when the type says PAN", () => {
    ok(validateTaxIdentity({ tax_id: "AALCK3037B", tax_id_type: "PAN" }))
    bad(validateTaxIdentity({ tax_id: "AALCK3037", tax_id_type: "PAN" }))
  })

  it("does not second-guess a type it has no format for", () => {
    // A VAT number's shape varies by country; refusing what we cannot check
    // would block legitimate partners.
    ok(validateTaxIdentity({ tax_id: "GB123456789", tax_id_type: "VAT" }))
  })

  it("allows CLEARING a wrongly-entered registration", () => {
    // Refusing to clear would leave bad data on a compliance field forever.
    const v = ok(validateTaxIdentity({ tax_id: null }))
    expect(v.tax_id).toBeNull()
    expect(v.tax_id_type).toBeNull()
  })

  it("clears the type along with the number, never leaving a type with nothing", () => {
    const v = ok(validateTaxIdentity({ tax_id: "", tax_id_type: "GSTIN" }))
    expect(v.tax_id).toBeNull()
    expect(v.tax_id_type).toBeNull()
  })

  it("refuses a non-string rather than coercing it", () => {
    bad(validateTaxIdentity({ tax_id: 21 as any, tax_id_type: "GSTIN" }))
    bad(validateTaxIdentity({ tax_id: "21AALCK3037B1Z4", tax_id_type: 1 as any }))
  })
})

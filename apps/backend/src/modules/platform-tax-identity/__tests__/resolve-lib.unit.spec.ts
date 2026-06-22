import {
  EU_VAT_COUNTRY_CODES,
  normalizeCountryCode,
  resolvePlatformTaxIdentity,
  resolvePlatformTaxIdString,
  type PlatformTaxIdentityRow,
} from "../resolve-lib"

const JYT: PlatformTaxIdentityRow = {
  brand_code: "JYT",
  legal_name: "Jaal Yantra Textiles Private Limited",
  tax_id: "07AAGCJ0494A1ZV",
  tax_id_type: "gstin",
  country_codes: ["IN"],
  is_active: true,
}

const KHT: PlatformTaxIdentityRow = {
  brand_code: "KHT",
  legal_name: "Kind Health Tech",
  tax_id: "40203579735",
  tax_id_type: "eu_vat",
  country_codes: EU_VAT_COUNTRY_CODES,
  is_active: true,
}

const SEED = [JYT, KHT]

describe("resolvePlatformTaxIdentity (#348 slice B)", () => {
  it("resolves India to the JYT GSTIN identity", () => {
    expect(resolvePlatformTaxIdentity("IN", SEED)?.brand_code).toBe("JYT")
    expect(resolvePlatformTaxIdString("IN", SEED)).toBe("07AAGCJ0494A1ZV")
  })

  it("resolves an EU country (LV, FR) to the KHT EU-VAT identity", () => {
    expect(resolvePlatformTaxIdentity("LV", SEED)?.brand_code).toBe("KHT")
    expect(resolvePlatformTaxIdentity("FR", SEED)?.brand_code).toBe("KHT")
    expect(resolvePlatformTaxIdString("FR", SEED)).toBe("40203579735")
  })

  it("is case-insensitive on the country code", () => {
    expect(resolvePlatformTaxIdentity("in", SEED)?.brand_code).toBe("JYT")
    expect(resolvePlatformTaxIdentity("fr", SEED)?.brand_code).toBe("KHT")
  })

  it("returns null for a jurisdiction the platform has no entity in", () => {
    expect(resolvePlatformTaxIdentity("US", SEED)).toBeNull()
    expect(resolvePlatformTaxIdString("US", SEED)).toBeUndefined()
  })

  it("returns null for missing/malformed country values", () => {
    expect(resolvePlatformTaxIdentity(null, SEED)).toBeNull()
    expect(resolvePlatformTaxIdentity(undefined, SEED)).toBeNull()
    expect(resolvePlatformTaxIdentity("India", SEED)).toBeNull()
    expect(resolvePlatformTaxIdentity("", SEED)).toBeNull()
  })

  it("skips inactive rows", () => {
    const disabled = [{ ...JYT, is_active: false }, KHT]
    expect(resolvePlatformTaxIdentity("IN", disabled)).toBeNull()
    expect(resolvePlatformTaxIdentity("FR", disabled)?.brand_code).toBe("KHT")
  })

  it("returns the first matching active row when several cover a country", () => {
    const altJyt: PlatformTaxIdentityRow = { ...JYT, tax_id: "27AAGCJ0494A1ZZ" }
    expect(resolvePlatformTaxIdentity("IN", [JYT, altJyt])?.tax_id).toBe(
      "07AAGCJ0494A1ZV"
    )
  })

  it("treats a present-but-blank tax_id as no fallback", () => {
    const blank = [{ ...JYT, tax_id: "   " }]
    expect(resolvePlatformTaxIdString("IN", blank)).toBeUndefined()
  })

  it("handles empty / null identity lists", () => {
    expect(resolvePlatformTaxIdentity("IN", [])).toBeNull()
    expect(resolvePlatformTaxIdentity("IN", null)).toBeNull()
    expect(resolvePlatformTaxIdentity("IN", undefined)).toBeNull()
  })
})

describe("normalizeCountryCode", () => {
  it("upper-cases 2-letter codes and rejects non-codes", () => {
    expect(normalizeCountryCode("in")).toBe("IN")
    expect(normalizeCountryCode("  fr ")).toBe("FR")
    expect(normalizeCountryCode("India")).toBeNull()
    expect(normalizeCountryCode("")).toBeNull()
    expect(normalizeCountryCode(null)).toBeNull()
  })
})

describe("EU_VAT_COUNTRY_CODES", () => {
  it("contains the 27 member states incl. Latvia", () => {
    expect(EU_VAT_COUNTRY_CODES).toHaveLength(27)
    expect(EU_VAT_COUNTRY_CODES).toContain("LV")
    expect(new Set(EU_VAT_COUNTRY_CODES).size).toBe(27)
  })
})

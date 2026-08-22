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

/**
 * Ship-from vs ship-to (#348 regression).
 *
 * These are the two rows that were live on prod. While JYT/IN was the only one,
 * keying the lookup on the CONSIGNEE country was indistinguishable from keying
 * it on the origin — every sale was India→India. Adding KHT, whose row covers
 * all 27 EU member states, made the two answers differ: a Shiprocket shipment to
 * Germany resolved a Latvian company number and stamped it into the shipment's
 * `tax_id`, which travels next to `customs` on an India-origin export.
 *
 * The goods always leave India. These tests pin the direction so the call site
 * cannot quietly flip back.
 */
const PROD_IDENTITIES = [
  {
    brand_code: "JYT",
    legal_name: "Jaal Yantra Textiles Private Limited",
    tax_id: "07AAGCJ0494A1ZV",
    tax_id_type: "gstin",
    country_codes: ["IN"],
    is_active: true,
  },
  {
    brand_code: "KHT",
    legal_name: "Kind Health Tech SIA",
    tax_id: "40203579735",
    tax_id_type: "eu_vat",
    country_codes: ["DE", "LV", "FR"],
    is_active: true,
  },
]

describe("ship-from keying (#348)", () => {
  it("stamps the Indian GSTIN on an India-origin export to Germany", () => {
    expect(resolvePlatformTaxIdString("IN", PROD_IDENTITIES)).toBe(
      "07AAGCJ0494A1ZV"
    )
  })

  it("would have stamped a Latvian company number if keyed on the destination", () => {
    // Documents the defect rather than the fix: this is what the call site
    // produced, and it is why the parameter is now named `shipFromCountryCode`.
    expect(resolvePlatformTaxIdString("DE", PROD_IDENTITIES)).toBe(
      "40203579735"
    )
  })

  it("returns undefined rather than a guess when the origin is unknown", () => {
    // The call site must pass null, never the destination, when it cannot read
    // the stock location's country. A blank field beats a false declaration.
    expect(resolvePlatformTaxIdString(null, PROD_IDENTITIES)).toBeUndefined()
  })

  it("ignores tax_id_type — deactivating is the only way to retire a row", () => {
    // `resolvePlatformTaxIdString` returns `tax_id` without reading the type, so
    // relabelling KHT's row from `eu_vat` to a registration number does NOT stop
    // the number reaching a label. Only `is_active: false` does.
    const relabelled = PROD_IDENTITIES.map((r) =>
      r.brand_code === "KHT" ? { ...r, tax_id_type: "lv_reg_no" } : r
    )
    expect(resolvePlatformTaxIdString("DE", relabelled)).toBe("40203579735")

    const deactivated = PROD_IDENTITIES.map((r) =>
      r.brand_code === "KHT" ? { ...r, is_active: false } : r
    )
    expect(resolvePlatformTaxIdString("DE", deactivated)).toBeUndefined()
  })
})

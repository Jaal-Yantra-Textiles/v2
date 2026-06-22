import {
  EU_VAT_COUNTRY_CODES,
  getPlatformTaxIdConfig,
  getPlatformTaxIds,
  normalizeBrand,
  resolveBrandForCountry,
  resolvePartnerTaxId,
  resolveTaxIdForCountry,
} from "../tax-id-lib"

describe("tax-id-lib (#348)", () => {
  describe("normalizeBrand", () => {
    it("passes through known brands, case-insensitively", () => {
      expect(normalizeBrand("JYT")).toBe("JYT")
      expect(normalizeBrand("kht")).toBe("KHT")
    })
    it("falls back to the default brand for missing/unknown values", () => {
      expect(normalizeBrand(null)).toBe("JYT")
      expect(normalizeBrand("  ")).toBe("JYT")
      expect(normalizeBrand("ACME")).toBe("JYT")
      expect(normalizeBrand("ACME", "KHT")).toBe("KHT")
    })
  })

  describe("resolveBrandForCountry", () => {
    it("maps India (IN / India / IND) → JYT", () => {
      expect(resolveBrandForCountry("IN")).toBe("JYT")
      expect(resolveBrandForCountry("in")).toBe("JYT")
      expect(resolveBrandForCountry("India")).toBe("JYT")
      expect(resolveBrandForCountry("IND")).toBe("JYT")
    })
    it("maps EU member states → KHT", () => {
      expect(resolveBrandForCountry("DE")).toBe("KHT")
      expect(resolveBrandForCountry("fr")).toBe("KHT")
      expect(resolveBrandForCountry("NL")).toBe("KHT")
    })
    it("returns null for non-IN / non-EU and empty input", () => {
      expect(resolveBrandForCountry("US")).toBeNull()
      expect(resolveBrandForCountry("GB")).toBeNull() // UK left the EU
      expect(resolveBrandForCountry(null)).toBeNull()
      expect(resolveBrandForCountry("")).toBeNull()
    })
    it("keeps the EU set free of non-members", () => {
      expect(EU_VAT_COUNTRY_CODES.has("GB")).toBe(false)
      expect(EU_VAT_COUNTRY_CODES.has("CH")).toBe(false)
      expect(EU_VAT_COUNTRY_CODES.has("DE")).toBe(true)
    })
  })

  describe("resolvePartnerTaxId (brand-keyed)", () => {
    const platformTaxIds = { JYT: "JYT-GSTIN-123", KHT: "KHT-VAT-456" }

    it("prefers the partner's own tax ID, carrying through its type", () => {
      const r = resolvePartnerTaxId({
        partnerTaxId: "PARTNER-GST-9",
        partnerTaxIdType: "gstin",
        brand: "JYT",
        platformTaxIds,
      })
      expect(r).toMatchObject({
        taxId: "PARTNER-GST-9",
        source: "partner",
        brand: "JYT",
        taxIdType: "gstin",
      })
    })

    it("falls back to the platform tax ID for the brand", () => {
      const r = resolvePartnerTaxId({ brand: "KHT", platformTaxIds })
      expect(r).toMatchObject({
        taxId: "KHT-VAT-456",
        source: "platform",
        brand: "KHT",
        taxIdType: "vat",
      })
    })

    it("returns none when neither partner nor platform has an ID", () => {
      const r = resolvePartnerTaxId({ brand: "JYT", platformTaxIds: {} })
      expect(r).toMatchObject({ taxId: null, source: "none", brand: "JYT" })
    })
  })

  describe("resolveTaxIdForCountry (country-aware, slice B)", () => {
    const config = getPlatformTaxIdConfig({
      PLATFORM_TAX_ID_JYT: "JYT-GSTIN-123",
      PLATFORM_TAX_ID_KHT: "KHT-VAT-456",
    })

    it("IN with no partner ID → JYT platform GSTIN", () => {
      const r = resolveTaxIdForCountry({ countryCode: "IN", config })
      expect(r).toMatchObject({
        taxId: "JYT-GSTIN-123",
        source: "platform",
        brand: "JYT",
        taxIdType: "gstin",
      })
    })

    it("an EU country (DE) with no partner ID → KHT platform VAT", () => {
      const r = resolveTaxIdForCountry({ countryCode: "DE", config })
      expect(r).toMatchObject({
        taxId: "KHT-VAT-456",
        source: "platform",
        brand: "KHT",
        taxIdType: "vat",
      })
    })

    it("partner-owned tax ID wins over the platform fallback (any country)", () => {
      const r = resolveTaxIdForCountry({
        partnerTaxId: "PARTNER-GST-9",
        partnerTaxIdType: "gstin",
        countryCode: "IN",
        config,
      })
      expect(r).toMatchObject({
        taxId: "PARTNER-GST-9",
        source: "partner",
        brand: "JYT",
        taxIdType: "gstin",
      })
    })

    it("unknown country with no partner ID → none", () => {
      const r = resolveTaxIdForCountry({ countryCode: "US", config })
      expect(r).toMatchObject({ taxId: null, source: "none" })
    })

    it("known country but unconfigured platform ID → none", () => {
      const r = resolveTaxIdForCountry({
        countryCode: "IN",
        config: getPlatformTaxIdConfig({}),
      })
      expect(r).toMatchObject({ taxId: null, source: "none", brand: "JYT" })
    })

    it("partner ID still wins even for an unknown jurisdiction", () => {
      const r = resolveTaxIdForCountry({
        partnerTaxId: "PARTNER-X",
        countryCode: "US",
        config,
      })
      expect(r).toMatchObject({ taxId: "PARTNER-X", source: "partner" })
    })
  })

  describe("getPlatformTaxIdConfig / getPlatformTaxIds (env)", () => {
    it("reads brand IDs + type overrides from env, with type defaults", () => {
      const cfg = getPlatformTaxIdConfig({
        PLATFORM_TAX_ID_JYT: "  JYT-1  ",
        PLATFORM_TAX_ID_KHT: "KHT-2",
        PLATFORM_TAX_ID_TYPE_KHT: "eu_vat",
      })
      expect(cfg.JYT).toEqual({ taxId: "JYT-1", taxIdType: "gstin" })
      expect(cfg.KHT).toEqual({ taxId: "KHT-2", taxIdType: "eu_vat" })
    })

    it("treats blank/missing env as null IDs", () => {
      const cfg = getPlatformTaxIdConfig({ PLATFORM_TAX_ID_JYT: "   " })
      expect(cfg.JYT.taxId).toBeNull()
      expect(cfg.KHT.taxId).toBeNull()
    })

    it("getPlatformTaxIds reads the same env keys", () => {
      expect(
        getPlatformTaxIds({ PLATFORM_TAX_ID_JYT: "J", PLATFORM_TAX_ID_KHT: "K" })
      ).toEqual({ JYT: "J", KHT: "K" })
    })
  })
})

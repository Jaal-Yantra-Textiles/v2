import {
  getPlatformTaxIds,
  normalizeBrand,
  resolvePartnerTaxId,
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

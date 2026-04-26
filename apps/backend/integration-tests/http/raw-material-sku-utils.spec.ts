import { buildSkuPrefix, formatSku, nextSequenceNumber } from "../../src/utils/generate-sku"

jest.setTimeout(30000)

describe("SKU Generation Utils", () => {
  describe("buildSkuPrefix", () => {
    it("should build prefix with category, material, and color", () => {
      expect(buildSkuPrefix("Fabric", "Cotton", "Blue")).toBe("FAB-COT-BLU")
    })

    it("should build prefix without color", () => {
      expect(buildSkuPrefix("Yarn", "Silk")).toBe("YRN-SIL")
    })

    it("should use OTH for unknown categories", () => {
      expect(buildSkuPrefix("Unknown", "Material")).toBe("OTH-MAT")
    })

    it("should handle all known categories", () => {
      expect(buildSkuPrefix("Fabric", "Test")).toBe("FAB-TES")
      expect(buildSkuPrefix("Fiber", "Test")).toBe("FIB-TES")
      expect(buildSkuPrefix("Yarn", "Test")).toBe("YRN-TES")
      expect(buildSkuPrefix("Trim", "Test")).toBe("TRIM-TES")
      expect(buildSkuPrefix("Dye", "Test")).toBe("DYE-TES")
      expect(buildSkuPrefix("Chemical", "Test")).toBe("CHEM-TES")
      expect(buildSkuPrefix("Accessory", "Test")).toBe("ACC-TES")
      expect(buildSkuPrefix("Other", "Test")).toBe("OTH-TES")
    })

    it("should truncate long names to 3 characters", () => {
      expect(buildSkuPrefix("Fabric", "Polyester", "Burgundy")).toBe("FAB-POL-BUR")
    })

    it("should strip non-alpha characters before abbreviating", () => {
      expect(buildSkuPrefix("Fabric", "100% Cotton", "Navy Blue")).toBe("FAB-COT-NAV")
    })

    it("should handle null color", () => {
      expect(buildSkuPrefix("Fabric", "Cotton", null)).toBe("FAB-COT")
    })

    it("should handle empty string color", () => {
      expect(buildSkuPrefix("Fabric", "Cotton", "")).toBe("FAB-COT")
    })
  })

  describe("formatSku", () => {
    it("should format with zero-padded sequence number", () => {
      expect(formatSku("FAB-COT-BLU", 1)).toBe("FAB-COT-BLU-001")
      expect(formatSku("FAB-COT-BLU", 42)).toBe("FAB-COT-BLU-042")
      expect(formatSku("FAB-COT-BLU", 999)).toBe("FAB-COT-BLU-999")
    })

    it("should handle numbers larger than 999", () => {
      expect(formatSku("FAB-COT", 1234)).toBe("FAB-COT-1234")
    })
  })

  describe("nextSequenceNumber", () => {
    it("should return 1 when no existing SKUs", () => {
      expect(nextSequenceNumber([], "FAB-COT-BLU")).toBe(1)
    })

    it("should return next number after highest existing", () => {
      const existing = ["FAB-COT-BLU-001", "FAB-COT-BLU-003", "FAB-COT-BLU-002"]
      expect(nextSequenceNumber(existing, "FAB-COT-BLU")).toBe(4)
    })

    it("should ignore SKUs with different prefixes", () => {
      const existing = ["FAB-COT-BLU-005", "YRN-SIL-001", "FAB-COT-RED-003"]
      expect(nextSequenceNumber(existing, "FAB-COT-BLU")).toBe(6)
    })

    it("should handle single existing SKU", () => {
      expect(nextSequenceNumber(["FAB-COT-001"], "FAB-COT")).toBe(2)
    })
  })
})

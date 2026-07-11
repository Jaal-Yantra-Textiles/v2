import {
  decodeRuleBool,
  canonicalRuleValue,
  needsStoreVisibilityRepair,
} from "../repair-shipping-option-store-visibility-job"

describe("repair-shipping-option-store-visibility pure helpers", () => {
  describe("decodeRuleBool", () => {
    it("passes canonical plain strings through", () => {
      expect(decodeRuleBool("true")).toBe("true")
      expect(decodeRuleBool("false")).toBe("false")
    })

    it("peels the double-encoded bug format ('\"true\"' → \"true\")", () => {
      // The exact value the buggy backend paths persisted (JSONB "\"true\"").
      expect(decodeRuleBool('"true"')).toBe("true")
      expect(decodeRuleBool('"false"')).toBe("false")
    })

    it("peels multiple quote layers defensively", () => {
      expect(decodeRuleBool('""true""')).toBe("true")
    })

    it("normalizes booleans (pre-persist form)", () => {
      expect(decodeRuleBool(true)).toBe("true")
      expect(decodeRuleBool(false)).toBe("false")
    })

    it("returns null for unrecognizable values (left untouched)", () => {
      expect(decodeRuleBool("banana")).toBeNull()
      expect(decodeRuleBool("")).toBeNull()
      expect(decodeRuleBool(42)).toBeNull()
      expect(decodeRuleBool(null)).toBeNull()
      expect(decodeRuleBool(undefined)).toBeNull()
      expect(decodeRuleBool({})).toBeNull()
    })
  })

  describe("needsStoreVisibilityRepair", () => {
    it("flags the malformed enabled form (the switched-off bug)", () => {
      expect(needsStoreVisibilityRepair('"true"')).toBe(true)
    })

    it("flags a malformed disabled form too (normalized, not force-enabled)", () => {
      expect(needsStoreVisibilityRepair('"false"')).toBe(true)
      expect(canonicalRuleValue('"false"')).toBe("false") // stays disabled
    })

    it("leaves already-canonical values untouched", () => {
      expect(needsStoreVisibilityRepair("true")).toBe(false)
      expect(needsStoreVisibilityRepair("false")).toBe(false)
    })

    it("does NOT touch unrecognizable values", () => {
      expect(needsStoreVisibilityRepair("banana")).toBe(false)
      expect(needsStoreVisibilityRepair(null)).toBe(false)
    })

    it("canonicalRuleValue enables the malformed-true case", () => {
      expect(canonicalRuleValue('"true"')).toBe("true")
    })
  })
})

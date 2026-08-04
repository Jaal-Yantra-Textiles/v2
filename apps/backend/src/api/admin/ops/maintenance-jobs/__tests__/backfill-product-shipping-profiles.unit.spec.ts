import {
  needsShippingProfile,
  pickTargetProfileId,
  summarizeProfileBackfill,
} from "../backfill-product-shipping-profiles-job"

describe("backfill-product-shipping-profiles pure helpers (#1195)", () => {
  describe("needsShippingProfile", () => {
    it("flags a product with no profile", () => {
      expect(needsShippingProfile({ id: "prod_1" })).toBe(true)
      expect(needsShippingProfile({ id: "prod_1", shipping_profile: null })).toBe(
        true
      )
    })

    it("never reassigns a product that already has one", () => {
      expect(
        needsShippingProfile({
          id: "prod_1",
          shipping_profile: { id: "sp_1" },
        })
      ).toBe(false)
    })

    it("ignores rows with no id", () => {
      expect(needsShippingProfile({})).toBe(false)
      expect(needsShippingProfile(null)).toBe(false)
    })
  })

  describe("pickTargetProfileId", () => {
    const profiles = [
      { id: "sp_default", type: "default" },
      { id: "sp_custom", type: "custom" },
    ]

    it("honours an explicit id that exists", () => {
      expect(pickTargetProfileId(profiles, "sp_custom")).toBe("sp_custom")
    })

    it("rejects an explicit id that does not exist", () => {
      expect(pickTargetProfileId(profiles, "sp_nope")).toBeNull()
    })

    it("falls back to the single default profile", () => {
      expect(pickTargetProfileId(profiles)).toBe("sp_default")
    })

    it("uses the only profile when there is no default-typed one", () => {
      expect(pickTargetProfileId([{ id: "sp_only", type: "custom" }])).toBe(
        "sp_only"
      )
    })

    it("refuses to guess when the choice is ambiguous", () => {
      // Two defaults, or several non-defaults — scattering products across
      // profiles silently would be worse than failing.
      expect(
        pickTargetProfileId([
          { id: "sp_a", type: "default" },
          { id: "sp_b", type: "default" },
        ])
      ).toBeNull()
      expect(
        pickTargetProfileId([
          { id: "sp_a", type: "custom" },
          { id: "sp_b", type: "custom" },
        ])
      ).toBeNull()
      expect(pickTargetProfileId([])).toBeNull()
    })
  })

  describe("summarizeProfileBackfill", () => {
    it("reports a clean scan", () => {
      expect(summarizeProfileBackfill(true, 20, 0, "sp_1")).toContain(
        "No changes"
      )
    })

    it("uses conditional wording for dry-run vs apply", () => {
      expect(summarizeProfileBackfill(true, 20, 5, "sp_1")).toContain(
        "Would link 5 of 20"
      )
      expect(summarizeProfileBackfill(false, 20, 5, "sp_1")).toContain(
        "Linked 5 of 20"
      )
    })
  })
})

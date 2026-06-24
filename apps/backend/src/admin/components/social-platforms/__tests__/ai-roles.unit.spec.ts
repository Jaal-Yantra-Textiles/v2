import {
  KNOWN_AI_ROLES,
  KNOWN_ROLE_VALUES,
  CUSTOM_ROLE_SENTINEL,
  ROLE_SLUG_REGEX,
  isKnownAiRole,
  isValidRoleSlug,
  roleToFormState,
  resolveRoleValue,
} from "../ai-roles"

describe("ai-roles shared module", () => {
  it("includes the 4 original roles plus the 2 resolver roles that previously drifted", () => {
    expect(KNOWN_ROLE_VALUES).toEqual(
      expect.arrayContaining([
        "ai_search_chat",
        "ai_search_embed",
        "ai_product_description",
        "ai_image_gen",
        "ai_digest_summary",
        "ai_newsletter_drafter",
      ])
    )
    // every entry carries a non-empty human label
    for (const r of KNOWN_AI_ROLES) {
      expect(r.label.length).toBeGreaterThan(0)
    }
  })

  describe("slug validation", () => {
    it("accepts sane custom role slugs", () => {
      expect(isValidRoleSlug("ai_marketing_vp")).toBe(true)
      expect(isValidRoleSlug("ai_blog_drafter")).toBe(true)
      expect(ROLE_SLUG_REGEX.test("x9_y")).toBe(true)
    })

    it("rejects empty, uppercase, leading-digit, and punctuation slugs", () => {
      expect(isValidRoleSlug("")).toBe(false)
      expect(isValidRoleSlug(null)).toBe(false)
      expect(isValidRoleSlug("AiMarketing")).toBe(false)
      expect(isValidRoleSlug("1role")).toBe(false)
      expect(isValidRoleSlug("ai marketing")).toBe(false)
      expect(isValidRoleSlug("ai-marketing")).toBe(false)
      // single char fails (needs 2+ to match `[a-z][a-z0-9_]+`)
      expect(isValidRoleSlug("a")).toBe(false)
    })
  })

  describe("resolveRoleValue", () => {
    it("passes the 4 existing known roles through verbatim (no regression)", () => {
      for (const value of [
        "ai_search_chat",
        "ai_search_embed",
        "ai_product_description",
        "ai_image_gen",
      ]) {
        expect(resolveRoleValue({ role: value, custom_role: "" })).toBe(value)
      }
    })

    it("maps the sentinel + custom slug into the final role string (trimmed)", () => {
      expect(
        resolveRoleValue({
          role: CUSTOM_ROLE_SENTINEL,
          custom_role: "  ai_marketing_vp  ",
        })
      ).toBe("ai_marketing_vp")
    })
  })

  describe("roleToFormState (edit-path round-trip)", () => {
    it("round-trips a known role into its own dropdown value with empty custom", () => {
      expect(roleToFormState("ai_newsletter_drafter")).toEqual({
        role: "ai_newsletter_drafter",
        custom_role: "",
      })
    })

    it("round-trips a custom stored metadata.role back as sentinel + custom value (not blank)", () => {
      expect(roleToFormState("ai_marketing_vp")).toEqual({
        role: CUSTOM_ROLE_SENTINEL,
        custom_role: "ai_marketing_vp",
      })
    })

    it("falls back to the first known role when nothing is stored", () => {
      expect(roleToFormState(null)).toEqual({
        role: KNOWN_ROLE_VALUES[0],
        custom_role: "",
      })
    })
  })

  describe("isKnownAiRole", () => {
    it("distinguishes known from custom roles", () => {
      expect(isKnownAiRole("ai_digest_summary")).toBe(true)
      expect(isKnownAiRole("ai_marketing_vp")).toBe(false)
      expect(isKnownAiRole(undefined)).toBe(false)
    })
  })
})

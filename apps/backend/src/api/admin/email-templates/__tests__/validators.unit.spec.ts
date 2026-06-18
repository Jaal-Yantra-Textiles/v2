import {
  CreateEmailTemplateSchema,
  UpdateEmailTemplateSchema,
} from "../validators"

describe("email-template validators", () => {
  describe("UpdateEmailTemplateSchema — is_active default must not survive .partial()", () => {
    it("does NOT inject is_active on a subject-only update", () => {
      // Regression: a `.default(true)` survives `.partial()` in Zod v4, so an
      // omitted is_active used to inject `true` and silently re-activate a
      // deactivated template (the route spreads ...validatedBody into update).
      const parsed = UpdateEmailTemplateSchema.parse({ subject: "New subject" })
      expect(parsed.is_active).toBeUndefined()
      expect("is_active" in parsed).toBe(false)
      expect(parsed.subject).toBe("New subject")
    })

    it("preserves an explicit is_active=false", () => {
      const parsed = UpdateEmailTemplateSchema.parse({ is_active: false })
      expect(parsed.is_active).toBe(false)
    })

    it("preserves an explicit is_active=true", () => {
      const parsed = UpdateEmailTemplateSchema.parse({ is_active: true })
      expect(parsed.is_active).toBe(true)
    })
  })

  describe("CreateEmailTemplateSchema — default stays intact on create", () => {
    it("still defaults is_active to true when omitted on create", () => {
      const parsed = CreateEmailTemplateSchema.parse({
        name: "T",
        from: "a@b.com",
        template_key: "k",
        subject: "S",
        html_content: "<p/>",
        template_type: "marketing",
      })
      expect(parsed.is_active).toBe(true)
    })
  })
})

import { reengagementEmailTemplates } from "../seed-reengagement-email-templates"

/**
 * Structural guards for the #450 re-engagement email templates seed.
 *
 * These templates are resolved by `template_key` (string) at send time, and the
 * Handlebars `{{var}}` placeholders are filled from a workflow/job payload. A
 * typo in a key or an undocumented placeholder silently renders blank, so pin
 * the contract here (the seed itself is DB-gated and can't be unit-run).
 */
describe("seed-reengagement-email-templates", () => {
  const KEYS = ["win-back", "back-in-stock", "browse-abandonment", "feedback-reminder"]

  it("seeds exactly the four net-new re-engagement templates with unique keys", () => {
    const keys = reengagementEmailTemplates.map((t) => t.template_key)
    expect(keys.sort()).toEqual([...KEYS].sort())
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("each row has the required non-empty fields", () => {
    for (const t of reengagementEmailTemplates) {
      expect(typeof t.template_key).toBe("string")
      expect(t.template_key.length).toBeGreaterThan(0)
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.subject.length).toBeGreaterThan(0)
      expect(t.html_content.length).toBeGreaterThan(0)
      expect(t.from.length).toBeGreaterThan(0)
      expect(t.is_active).toBe(true)
      expect(t.variables).toBeTruthy()
    }
  })

  it("does not collide with the order / partner / additional lifecycle templates", () => {
    // The order + partner lifecycle sets and the #618 additional set are already
    // complete; this seed must never re-add one of them.
    const keys = reengagementEmailTemplates.map((t) => t.template_key)
    for (const taken of [
      "order-placed",
      "order-shipment-created",
      "order-feedback-request",
      "partner-welcome",
      "payment-receipt",
    ]) {
      expect(keys).not.toContain(taken)
    }
  })

  it("documents every bare Handlebars placeholder it references", () => {
    // Bare identifiers only — skip block helpers (#if/#each/#unless), closers (/x),
    // `this.*`, and dotted paths.
    const helperOrPath = /^[#/^]|^else$|\.|\s/
    for (const t of reengagementEmailTemplates) {
      const documented = new Set(Object.keys(t.variables))
      const text = `${t.subject} ${t.html_content}`
      const tokens = [...text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1])
      for (const raw of tokens) {
        if (helperOrPath.test(raw)) continue // helper, closer, or dotted path
        expect(documented.has(raw)).toBe(true)
      }
    }
  })
})

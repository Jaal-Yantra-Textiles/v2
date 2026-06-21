import { additionalEmailTemplates } from "../seed-additional-email-templates"

/**
 * Structural guards for the #450 additional email templates seed.
 *
 * These templates are resolved by `template_key` (string) at send time, and the
 * Handlebars `{{var}}` placeholders are filled from a workflow payload. A typo
 * in a key or an undocumented placeholder silently renders blank, so pin the
 * contract here (the seed itself is DB-gated and can't be unit-run).
 */
describe("seed-additional-email-templates", () => {
  const KEYS = ["partner-welcome", "order-feedback-request", "payment-receipt"]

  it("seeds exactly the three net-new templates with unique keys", () => {
    const keys = additionalEmailTemplates.map((t) => t.template_key)
    expect(keys.sort()).toEqual([...KEYS].sort())
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("each row has the required non-empty fields", () => {
    for (const t of additionalEmailTemplates) {
      expect(typeof t.template_key).toBe("string")
      expect(t.template_key.length).toBeGreaterThan(0)
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.subject.length).toBeGreaterThan(0)
      expect(t.html_content.length).toBeGreaterThan(0)
      expect(t.is_active).toBe(true)
      expect(t.variables).toBeTruthy()
    }
  })

  it("does not collide with templates already shipped in seed-email-templates", () => {
    // order-placed / order-shipment-created already cover the customer
    // order-confirmation + shipment groups from #450; this seed must not re-add them.
    const keys = additionalEmailTemplates.map((t) => t.template_key)
    expect(keys).not.toContain("order-placed")
    expect(keys).not.toContain("order-shipment-created")
    expect(keys).not.toContain("payment-captured")
  })

  it("documents every bare Handlebars placeholder it references", () => {
    // Bare identifiers only — skip block helpers (#if/#each/#unless), closers (/x),
    // `this.*`, and dotted paths handled inside loops.
    const helperOrPath = /^[#/^]|^else$|\.|\s/
    for (const t of additionalEmailTemplates) {
      const documented = new Set(Object.keys(t.variables))
      const text = `${t.subject} ${t.html_content}`
      const tokens = [...text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1])
      for (const raw of tokens) {
        if (helperOrPath.test(raw)) continue // helper, closer, or dotted path
        // strip a leading block-condition operand like "#if dashboard_url" already skipped above
        expect(documented.has(raw)).toBe(true)
      }
    }
  })
})

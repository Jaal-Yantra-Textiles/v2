import { cleanSpecOptionsForSave } from "../clean-spec-options"

/**
 * The live failure this fixes, reported from the admin UI:
 *
 *   Invalid request: Value for field 'options, 0, values, 0, label' too small,
 *   expected at least: '1'
 *
 * The form's `emptyOption` is born with one blank value — deliberately, because
 * the route rejects a group with none — and `handleSave` cleaned `colors` and
 * `fields` but never `options`. So the form created a row that the form then
 * could not save, and answered a partner in zod field paths.
 */

const group = (over: Record<string, any> = {}) => ({
  key: "embroidery",
  label: "Embroidery",
  values: [{ label: "None" }, { label: "Paisley border" }],
  ...over,
})

describe("cleanSpecOptionsForSave", () => {
  describe("the reported failure", () => {
    it("drops the blank value row the form seeds", () => {
      const r = cleanSpecOptionsForSave([
        group({ values: [{ label: "None" }, { label: "" }] }),
      ])

      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error("unreachable")
      expect(r.options[0].values).toEqual([{ label: "None", note: null }])
    })

    it("drops a whole group nobody touched — key, label and value all blank", () => {
      const r = cleanSpecOptionsForSave([
        group(),
        { key: "", label: "", values: [{ label: "" }] },
      ])

      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error("unreachable")
      expect(r.options).toHaveLength(1)
    })

    it("treats whitespace as blank", () => {
      const r = cleanSpecOptionsForSave([
        { key: "   ", label: "  ", values: [{ label: "   " }] },
      ])
      expect(r).toEqual({ ok: true, options: [] })
    })
  })

  describe("a named group with no choices is an ERROR, not noise", () => {
    it("refuses, naming the group in prose rather than a field path", () => {
      const r = cleanSpecOptionsForSave([
        group({ label: "Border", values: [{ label: "" }] }),
      ])

      expect(r.ok).toBe(false)
      if (r.ok) throw new Error("unreachable")
      expect(r.error).toContain("Border")
      expect(r.error).not.toMatch(/options,|too small|z\.|values, 0/)
    })

    it("falls back to the key, then to a position, when there is no label", () => {
      const byKey = cleanSpecOptionsForSave([
        { key: "border", label: "", values: [] },
      ])
      expect(byKey.ok).toBe(false)
      if (byKey.ok) throw new Error("unreachable")
      expect(byKey.error).toContain("border")
    })

    it("refuses a named group with no key, in words", () => {
      const r = cleanSpecOptionsForSave([
        group({ key: "", label: "Embroidery" }),
      ])

      expect(r.ok).toBe(false)
      if (r.ok) throw new Error("unreachable")
      expect(r.error).toContain("Embroidery")
      expect(r.error).toContain("key")
    })
  })

  describe("it does not damage a good payload", () => {
    it("keeps a complete group intact", () => {
      const r = cleanSpecOptionsForSave([group()])

      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error("unreachable")
      expect(r.options[0]).toMatchObject({
        key: "embroidery",
        label: "Embroidery",
      })
      expect(r.options[0].values).toHaveLength(2)
    })

    it("trims rather than rejecting padded input", () => {
      const r = cleanSpecOptionsForSave([
        { key: " embroidery ", label: " Embroidery ", values: [{ label: " None " }] },
      ])

      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error("unreachable")
      expect(r.options[0]).toMatchObject({ key: "embroidery", label: "Embroidery" })
      expect(r.options[0].values?.[0].label).toBe("None")
    })

    it("preserves fields the cleaner has no business touching", () => {
      const r = cleanSpecOptionsForSave([
        group({ required: true, order: 3, values: [{ label: "None", available: false, order: 2 }] }),
      ])

      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error("unreachable")
      expect(r.options[0]).toMatchObject({ required: true, order: 3 })
      expect(r.options[0].values?.[0]).toMatchObject({ available: false, order: 2 })
    })

    it("handles no options at all", () => {
      expect(cleanSpecOptionsForSave(undefined)).toEqual({ ok: true, options: [] })
      expect(cleanSpecOptionsForSave([])).toEqual({ ok: true, options: [] })
    })
  })
})

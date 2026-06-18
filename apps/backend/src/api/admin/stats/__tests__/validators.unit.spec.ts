import {
  createPanelSchema,
  updatePanelSchema,
  previewPanelSchema,
} from "../validators"

describe("stats panel validators", () => {
  describe("updatePanelSchema — operation_options default must not survive .partial()", () => {
    it("does NOT inject operation_options on a metadata-only update", () => {
      // Regression: a metadata-only PUT (e.g. toggling metadata.public from the
      // share-publicly UI) must leave operation_options undefined so the route
      // falls back to the stored value instead of clobbering it with {}.
      const parsed = updatePanelSchema.parse({ metadata: { public: true } })
      expect(parsed.operation_options).toBeUndefined()
      expect("operation_options" in parsed).toBe(false)
      expect(parsed.metadata).toEqual({ public: true })
    })

    it("does NOT inject operation_options on a position-only update", () => {
      const parsed = updatePanelSchema.parse({ x: 2, y: 3 })
      expect(parsed.operation_options).toBeUndefined()
    })

    it("preserves an explicitly provided operation_options", () => {
      const parsed = updatePanelSchema.parse({
        operation_options: { limit: 5 },
      })
      expect(parsed.operation_options).toEqual({ limit: 5 })
    })

    it("keeps operation_type optional on update", () => {
      expect(() => updatePanelSchema.parse({ name: "Renamed" })).not.toThrow()
    })

    it("the route's `operation_type || operation_options` guard stays falsy for a metadata-only update", () => {
      // Mirrors the PUT route guard: with the bug, operation_options was always
      // {} (truthy) so the guard always ran and re-validated/clobbered options.
      const data = updatePanelSchema.parse({ metadata: { public: true } })
      expect(Boolean(data.operation_type || data.operation_options)).toBe(false)
    })
  })

  describe("createPanelSchema — default behavior is intentionally retained", () => {
    it("still defaults operation_options to {} on create", () => {
      const parsed = createPanelSchema.parse({
        name: "New panel",
        operation_type: "count_orders",
      })
      expect(parsed.operation_options).toEqual({})
    })

    it("still requires name and operation_type on create", () => {
      expect(() => createPanelSchema.parse({ name: "x" })).toThrow()
      expect(() => createPanelSchema.parse({ operation_type: "y" })).toThrow()
    })
  })

  describe("previewPanelSchema — unchanged", () => {
    it("defaults operation_options to {}", () => {
      const parsed = previewPanelSchema.parse({ operation_type: "count_orders" })
      expect(parsed.operation_options).toEqual({})
    })
  })
})

import { pickDesignVariant, resolveRunVariant } from "../lib/run-variant"

/**
 * #2057 — which variant a run's output belongs to.
 *
 * `design-variant-link` was `isList: false` on the variant side, so a design
 * could only ever hold ONE variant — a second write threw. Every reader took
 * `design_product_variant[0]` and was correct only because of that. Opening the
 * link so a design can carry sizes and colourways turns each `[0]` into a
 * lottery: a Small banked as a Large, with nothing afterwards to show it.
 */
describe("run variant resolution (#2057)", () => {
  describe("pickDesignVariant", () => {
    it("returns the single linked variant", () => {
      expect(pickDesignVariant([{ product_variant_id: "var_1" }])).toEqual({ id: "var_1" })
    })

    it("returns null when there is none", () => {
      expect(pickDesignVariant([])).toBeNull()
      expect(pickDesignVariant(null)).toBeNull()
      expect(pickDesignVariant(undefined)).toBeNull()
      expect(pickDesignVariant([null])).toBeNull()
      expect(pickDesignVariant([{ product_variant_id: null }])).toBeNull()
    })

    /** The whole reason the link could safely be opened up. */
    it("REFUSES to guess between two variants", () => {
      expect(
        pickDesignVariant([{ product_variant_id: "var_s" }, { product_variant_id: "var_m" }])
      ).toBeNull()
    })

    it("treats the same variant listed twice as unambiguous", () => {
      expect(
        pickDesignVariant([{ product_variant_id: "var_1" }, { product_variant_id: "var_1" }])
      ).toEqual({ id: "var_1" })
    })
  })

  describe("resolveRunVariant", () => {
    const makeContainer = (graph: (args: any) => any) => ({
      resolve: (key: string) =>
        String(key).toLowerCase().includes("logger")
          ? { error: () => {}, warn: () => {}, info: () => {} }
          : { graph: async (args: any) => graph(args) },
    })

    const withInventory = (extra: (args: any) => any) => (args: any) => {
      if (args.entity === "product_variant_inventory_item") {
        return { data: [{ inventory_item_id: `iitem_for_${args.filters.variant_id}` }] }
      }
      return extra(args)
    }

    it("prefers the run's own variant over the design link", async () => {
      const container = makeContainer(
        withInventory((args) => {
          if (args.entity === "design_product_variant") {
            return { data: [{ product_variant_id: "var_from_design" }] }
          }
          return { data: [] }
        })
      )
      await expect(
        resolveRunVariant(container, { variant_id: "var_on_run", design_id: "des_1" })
      ).resolves.toEqual({
        variant_id: "var_on_run",
        inventory_item_id: "iitem_for_var_on_run",
        source: "run",
      })
    })

    it("falls back to the design link for runs written before the column", async () => {
      const container = makeContainer(
        withInventory((args) => {
          if (args.entity === "design_product_variant") {
            return { data: [{ product_variant_id: "var_from_design" }] }
          }
          return { data: [] }
        })
      )
      await expect(
        resolveRunVariant(container, { variant_id: null, design_id: "des_1" })
      ).resolves.toEqual({
        variant_id: "var_from_design",
        inventory_item_id: "iitem_for_var_from_design",
        source: "design_link",
      })
    })

    /**
     * The case the link change creates. Must be distinguishable from
     * "no variant yet" — one is a refusal, the other a legitimate no-op.
     */
    it("refuses, with the candidates, when the design has two variants", async () => {
      const container = makeContainer(
        withInventory((args) => {
          if (args.entity === "design_product_variant") {
            return {
              data: [{ product_variant_id: "var_s" }, { product_variant_id: "var_m" }],
            }
          }
          return { data: [] }
        })
      )
      await expect(
        resolveRunVariant(container, { variant_id: null, design_id: "des_1" })
      ).resolves.toEqual({
        reason: "ambiguous_design_variants",
        candidate_variant_ids: ["var_s", "var_m"],
      })
    })

    it("a run naming its own variant is NOT ambiguous, even with many on the design", async () => {
      const container = makeContainer(
        withInventory((args) => {
          if (args.entity === "design_product_variant") {
            return {
              data: [{ product_variant_id: "var_s" }, { product_variant_id: "var_m" }],
            }
          }
          return { data: [] }
        })
      )
      const res = await resolveRunVariant(container, {
        variant_id: "var_m",
        design_id: "des_1",
      })
      expect(res.reason).toBeUndefined()
      expect(res.variant_id).toBe("var_m")
    })

    /**
     * #2271 — approval stamps `approved_variant_id` per run and leaves
     * `variant_id` null (both approved Sharlho runs on prod). On a design that
     * holds a variant per size the link is ambiguous, so without this the
     * stocking step refused a run whose approval had already named its variant.
     */
    it("uses the variant approval stamped when the run names none", async () => {
      const container = makeContainer(
        withInventory((args) => {
          if (args.entity === "design_product_variant") {
            return {
              data: [{ product_variant_id: "var_s" }, { product_variant_id: "var_m" }],
            }
          }
          return { data: [] }
        })
      )
      await expect(
        resolveRunVariant(container, {
          variant_id: null,
          approved_variant_id: "var_m",
          design_id: "des_1",
        })
      ).resolves.toEqual({
        variant_id: "var_m",
        inventory_item_id: "iitem_for_var_m",
        source: "approval",
      })
    })

    it("the run's own variant still beats the approval stamp", async () => {
      const container = makeContainer(withInventory(() => ({ data: [] })))
      const res = await resolveRunVariant(container, {
        variant_id: "var_on_run",
        approved_variant_id: "var_approved",
        design_id: "des_1",
      })
      expect(res.variant_id).toBe("var_on_run")
      expect(res.source).toBe("run")
    })

    it("says design_has_no_variant when the design links none", async () => {
      const container = makeContainer(
        withInventory((args) => {
          if (args.entity === "design_product_variant") return { data: [] }
          return { data: [] }
        })
      )
      await expect(
        resolveRunVariant(container, { variant_id: null, design_id: "des_1" })
      ).resolves.toEqual({ reason: "design_has_no_variant" })
    })

    it("says no_variant_and_no_design when the run has neither", async () => {
      const container = makeContainer(() => ({ data: [] }))
      await expect(
        resolveRunVariant(container, { variant_id: null, design_id: null })
      ).resolves.toEqual({ reason: "no_variant_and_no_design" })
    })

    it("reports a variant with no inventory item, keeping the variant id", async () => {
      const container = makeContainer((args) => {
        if (args.entity === "product_variant_inventory_item") return { data: [] }
        return { data: [] }
      })
      await expect(
        resolveRunVariant(container, { variant_id: "var_1", design_id: "des_1" })
      ).resolves.toEqual({
        variant_id: "var_1",
        source: "run",
        reason: "variant_has_no_inventory_item",
      })
    })
  })
})

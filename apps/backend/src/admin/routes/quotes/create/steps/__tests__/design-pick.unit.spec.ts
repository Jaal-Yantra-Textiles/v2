import { resolveDesignPick, candidateOptions, PickableDesign } from "../design-pick"

/**
 * The bug: a design backed by SEVERAL variants rendered permanently disabled
 * in the quote wizard, under the backend's own instruction to "pick the one to
 * quote" — with no picker. `quotable` is Boolean(variant_id) so it was false,
 * and `made_to_order` is true only for ZERO candidates, so the several case
 * fell through every branch.
 */

const design = (over: Partial<PickableDesign> = {}): PickableDesign => ({
  id: "design_1",
  quotable: false,
  made_to_order: false,
  variant_id: null,
  product_id: null,
  candidates: [],
  ...over,
})

const candidate = (id: string, over: Partial<any> = {}) => ({
  variant_id: id,
  title: `Variant ${id}`,
  sku: `SKU-${id}`,
  product_id: `prod_${id}`,
  product_title: "Handwoven Stole",
  ...over,
})

describe("resolveDesignPick", () => {
  describe("the case the wizard never had: several candidates", () => {
    const multi = design({
      candidates: [candidate("v1"), candidate("v2"), candidate("v3")],
    })

    it("is selectable — not the dead row it used to be", () => {
      expect(resolveDesignPick(multi).selectable).toBe(true)
    })

    it("asks for a choice before it can be ticked", () => {
      const p = resolveDesignPick(multi)
      expect(p.needs_choice).toBe(true)
      expect(p.variant_id).toBeNull()
      expect(p.product_id).toBeNull()
    })

    it("resolves to the chosen variant and its product", () => {
      const p = resolveDesignPick(multi, "v2")
      expect(p.needs_choice).toBe(false)
      expect(p.variant_id).toBe("v2")
      expect(p.product_id).toBe("prod_v2")
    })

    it("still asks when the chosen id is not one of the candidates", () => {
      // A stale choice left over from another design must not select a variant
      // this design does not have.
      const p = resolveDesignPick(multi, "v_from_another_design")
      expect(p.needs_choice).toBe(true)
      expect(p.variant_id).toBeNull()
    })

    it("refuses a chosen candidate that has no product behind it", () => {
      const d = design({
        candidates: [candidate("v1"), candidate("v2", { product_id: null })],
      })
      const p = resolveDesignPick(d, "v2")
      // The basket is keyed by product: selecting this would silently drop out.
      expect(p.variant_id).toBeNull()
      expect(p.needs_choice).toBe(true)
      expect(p.blocked_reason).toMatch(/pick another/i)
    })
  })

  describe("the two cases that already worked, which must not regress", () => {
    it("a single resolved variant ticks straight through", () => {
      const d = design({
        quotable: true,
        variant_id: "v1",
        product_id: "prod_v1",
        candidates: [candidate("v1")],
      })
      const p = resolveDesignPick(d)
      expect(p).toMatchObject({
        variant_id: "v1",
        product_id: "prod_v1",
        needs_choice: false,
        mints_on_pick: false,
        selectable: true,
      })
    })

    it("a made-to-order design mints on pick", () => {
      const d = design({ made_to_order: true })
      const p = resolveDesignPick(d)
      expect(p.mints_on_pick).toBe(true)
      expect(p.selectable).toBe(true)
      expect(p.needs_choice).toBe(false)
    })

    it("a stale choice never overrides a variant the backend resolved", () => {
      const d = design({
        quotable: true,
        variant_id: "v1",
        product_id: "prod_v1",
        candidates: [candidate("v1"), candidate("v2")],
      })
      // The row displays v1. Quoting v2 here would price something other than
      // what the operator is looking at.
      expect(resolveDesignPick(d, "v2").variant_id).toBe("v1")
    })
  })

  describe("what genuinely cannot be quoted", () => {
    it("no candidates and not made-to-order is blocked, with a reason", () => {
      const p = resolveDesignPick(design())
      expect(p.selectable).toBe(false)
      expect(p.blocked_reason).toBeTruthy()
    })

    it("a resolved variant with no product is blocked rather than silently dropped", () => {
      const d = design({ quotable: true, variant_id: "v1", product_id: null })
      const p = resolveDesignPick(d)
      expect(p.selectable).toBe(false)
      expect(p.blocked_reason).toBeTruthy()
    })
  })
})

describe("candidateOptions", () => {
  it("labels each candidate by product and variant", () => {
    const d = design({ candidates: [candidate("v1")] })
    expect(candidateOptions(d)).toEqual([
      { value: "v1", label: "Handwoven Stole · Variant v1" },
    ])
  })

  it("falls back to the sku, then the id, rather than rendering blank", () => {
    const d = design({
      candidates: [
        candidate("v1", { title: null, product_title: null }),
        candidate("v2", { title: null, product_title: null, sku: null }),
      ],
    })
    expect(candidateOptions(d)).toEqual([
      { value: "v1", label: "SKU-v1" },
      { value: "v2", label: "v2" },
    ])
  })

  it("offers every candidate, so none is unreachable", () => {
    const d = design({
      candidates: [candidate("v1"), candidate("v2"), candidate("v3")],
    })
    expect(candidateOptions(d).map((o) => o.value)).toEqual(["v1", "v2", "v3"])
  })
})

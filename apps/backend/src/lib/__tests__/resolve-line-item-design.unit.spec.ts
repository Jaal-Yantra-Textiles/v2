import { resolveLineItemDesignId } from "../resolve-line-item-production"

/**
 * The priority order is the whole point of #1919, and getting it backwards is
 * silent: every branch returns a plausible design id, so a wrong precedence
 * shows up as the WRONG design being produced, not as an error.
 */

/**
 * A query stub keyed on the query's SHAPE, not on `entity`.
 *
 * 🔴 `defineLink(...).entryPoint` is EMPTY at import time — the Medusa runtime
 * populates it when it loads links, which does not happen in a unit test. So
 * the link lookup here arrives with `entity: ""`, and a stub keyed on the name
 * would silently answer nothing and the test would "pass" against a resolver
 * that never consults the link at all. (This is the same trap as a wrong
 * `entity:` name: it returns EMPTY, never an error.) Keying on the filter the
 * caller actually sends is both robust and a truer description of the contract.
 */
const makeQuery = (byEntity: Record<string, any[]>) => {
  const calls: string[] = []
  return {
    calls,
    graph: jest.fn(async ({ entity, filters }: any) => {
      const key = filters?.order_line_item_id
        ? LINK
        : filters?.product_variant_id
          ? "design_product_variant"
          : filters?.product_id
            ? "product_design"
            : String(entity ?? "")
      calls.push(key)
      return { data: byEntity[key] ?? [] }
    }),
  }
}

const LINK = "design_order_line_item"

describe("resolveLineItemDesignId — precedence", () => {
  it("prefers the per-item LINK over metadata.design_id", async () => {
    // The exact shape after a re-point: the link says B, provenance still says A.
    const q = makeQuery({ [LINK]: [{ design_id: "design_B" }] })
    const r = await resolveLineItemDesignId(q as any, {
      lineItemId: "item_1",
      metadata: { design_id: "design_A" },
    })
    expect(r.designId).toBe("design_B")
    expect(r.source).toBe("link")
  })

  it("prefers the LINK over the variant association", async () => {
    const q = makeQuery({
      [LINK]: [{ design_id: "design_B" }],
      design_product_variant: [{ design_id: "design_V" }],
    })
    const r = await resolveLineItemDesignId(q as any, {
      lineItemId: "item_1",
      variantId: "variant_1",
    })
    expect(r.designId).toBe("design_B")
    expect(r.source).toBe("link")
  })

  it("does not even ask the other sources once the link answers", async () => {
    const q = makeQuery({ [LINK]: [{ design_id: "design_B" }] })
    await resolveLineItemDesignId(q as any, {
      lineItemId: "item_1",
      variantId: "variant_1",
      productId: "prod_1",
      metadata: { design_id: "design_A" },
    })
    expect(q.calls).toEqual([LINK])
  })

  /**
   * The #1918 shape: a design-order item with NO product and NO variant. The
   * old signature could not resolve this at all, which is how five paid-for
   * designs were skipped.
   */
  it("resolves an item that has neither a product nor a variant", async () => {
    const q = makeQuery({})
    const r = await resolveLineItemDesignId(q as any, {
      lineItemId: "item_1",
      metadata: { design_id: "design_A" },
    })
    expect(r.designId).toBe("design_A")
    expect(r.source).toBe("metadata")
    expect(r.isCustomDesign).toBe(true)
  })

  it("still resolves the variant association when there is no link", async () => {
    const q = makeQuery({ design_product_variant: [{ design_id: "design_V" }] })
    const r = await resolveLineItemDesignId(q as any, {
      lineItemId: "item_1",
      variantId: "variant_1",
    })
    expect(r.designId).toBe("design_V")
    expect(r.source).toBe("variant")
    expect(r.isCustomDesign).toBe(true)
  })

  it("still resolves the product association, and does not call it custom", async () => {
    const q = makeQuery({ product_design: [{ design: { id: "design_P" } }] })
    const r = await resolveLineItemDesignId(q as any, {
      lineItemId: "item_1",
      productId: "prod_1",
    })
    expect(r.designId).toBe("design_P")
    expect(r.source).toBe("product")
    expect(r.isCustomDesign).toBe(false)
  })

  it("prefers the variant association over the product one", async () => {
    const q = makeQuery({
      design_product_variant: [{ design_id: "design_V" }],
      product_design: [{ design: { id: "design_P" } }],
    })
    const r = await resolveLineItemDesignId(q as any, {
      variantId: "variant_1",
      productId: "prod_1",
    })
    expect(r.designId).toBe("design_V")
  })

  it("reports null rather than inventing a source when nothing resolves", async () => {
    const q = makeQuery({})
    const r = await resolveLineItemDesignId(q as any, { lineItemId: "item_1" })
    expect(r).toEqual({ designId: null, isCustomDesign: false, source: null })
  })

  /**
   * An unlinked item keeps its provenance string, so "design-less" must not be
   * inferred from the absence of a link alone. A caller that wants "no design
   * now" has to look at `source`, which is why it exists.
   */
  it("a non-string or empty metadata.design_id is not a design", async () => {
    const q = makeQuery({})
    for (const bad of [null, undefined, "", 0, {}, []]) {
      const r = await resolveLineItemDesignId(q as any, {
        lineItemId: "item_1",
        metadata: { design_id: bad } as any,
      })
      expect(r.designId).toBeNull()
      expect(r.source).toBeNull()
    }
  })
})

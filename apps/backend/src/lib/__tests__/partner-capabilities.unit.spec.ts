import {
  handlesPhysicalGoods,
  sellsDirect,
  type PhysicalGoodsEvidence,
} from "../partner-capabilities"

/**
 * #2061 — the two orthogonal questions, answered from evidence.
 *
 * The cases that matter are the ones where a plausible-looking rule quietly
 * mislabels a real partner: a weaver with an unconfigured catalogue, and a
 * partner who was created five minutes ago.
 */

const noEvidence: PhysicalGoodsEvidence = {
  productionRunCount: 0,
  stockLocationCount: 0,
  inventoryItemCount: 0,
  shippableProductCount: 0,
  productCount: 0,
}

describe("sellsDirect", () => {
  it("is true only when a storefront is actually provisioned", () => {
    expect(
      sellsDirect({ vercel_linked: true, storefront_domain: "gof.asia" })
    ).toBe(true)
  })

  it("a linked project with no domain is not a storefront", () => {
    expect(sellsDirect({ vercel_linked: true, storefront_domain: null })).toBe(
      false
    )
  })

  it("a domain with nothing deployed behind it is not a storefront", () => {
    expect(
      sellsDirect({ vercel_linked: false, storefront_domain: "x.cicilabel.com" })
    ).toBe(false)
  })

  it("does not read a workspace_type or a use_type to decide", () => {
    // Unique Pashmina's shape: manufacturer in the column, seller in the blob,
    // and a verified custom domain. The domain is what makes it true.
    expect(
      sellsDirect({
        vercel_linked: true,
        storefront_domain: "uniquepashmina.cicilabel.com",
      } as never)
    ).toBe(true)
    expect(sellsDirect(null)).toBe(false)
    expect(sellsDirect({})).toBe(false)
  })
})

describe("handlesPhysicalGoods", () => {
  it("a production run is proof something physical was made", () => {
    expect(
      handlesPhysicalGoods({ ...noEvidence, productionRunCount: 1 })
    ).toBe("yes")
  })

  it("a linked stock location is proof goods are held", () => {
    expect(handlesPhysicalGoods({ ...noEvidence, stockLocationCount: 1 })).toBe(
      "yes"
    )
  })

  it("held inventory is proof", () => {
    expect(handlesPhysicalGoods({ ...noEvidence, inventoryItemCount: 4 })).toBe(
      "yes"
    )
  })

  it("a shippable product is proof", () => {
    expect(
      handlesPhysicalGoods({
        ...noEvidence,
        productCount: 3,
        shippableProductCount: 1,
      })
    ).toBe("yes")
  })

  it("🔴 a weaver whose catalogue has no shipping profiles is UNKNOWN, not no", () => {
    // #1195: most of this catalogue has no shipping profile, so
    // shippableProductCount === 0 means "unconfigured", not "not physical".
    // Returning "no" here would label handwoven shawls as non-physical.
    expect(
      handlesPhysicalGoods({
        ...noEvidence,
        productCount: 12,
        shippableProductCount: 0,
      })
    ).toBe("unknown")
  })

  it("🔴 a partner created this morning is UNKNOWN, not no", () => {
    expect(handlesPhysicalGoods(noEvidence)).toBe("unknown")
  })

  it("never returns no from evidence alone", () => {
    const shapes: PhysicalGoodsEvidence[] = [
      noEvidence,
      { ...noEvidence, productCount: 1 },
      { ...noEvidence, productCount: 99 },
      { ...noEvidence, productCount: 99, shippableProductCount: 0 },
    ]
    for (const shape of shapes) {
      expect(handlesPhysicalGoods(shape)).not.toBe("no")
    }
  })
})

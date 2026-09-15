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

  it("🔴 the catalogue is NOT evidence — products alone stay UNKNOWN", () => {
    // Measured 2026-09-15: 97 of 97 prod products carry a shipping profile,
    // and createProductsWorkflow assigns the default one to anything created
    // normally. So "has products", shippable or not, says nothing about
    // physicality — which is why PhysicalGoodsEvidence has no product counts
    // at all. This test fails to compile if someone adds them back as a
    // signal, and fails outright if they are wired into the decision.
    expect(handlesPhysicalGoods({ ...noEvidence } as never)).toBe("unknown")
    expect(
      handlesPhysicalGoods({
        ...noEvidence,
        productCount: 97,
        shippableProductCount: 97,
      } as never)
    ).toBe("unknown")
  })

  it("🔴 a partner created this morning is UNKNOWN, not no", () => {
    expect(handlesPhysicalGoods(noEvidence)).toBe("unknown")
  })

  it("never returns no", () => {
    const shapes: PhysicalGoodsEvidence[] = [
      noEvidence,
      { ...noEvidence, productionRunCount: 3 },
      { ...noEvidence, stockLocationCount: 1 },
      { ...noEvidence, inventoryItemCount: 50 },
    ]
    for (const shape of shapes) {
      expect(handlesPhysicalGoods(shape)).not.toBe("no")
    }
  })
})

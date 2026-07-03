import { collectVariantPriceIds } from "../fanout-variant-prices"

/**
 * Pure price-id extraction for the shared FX fanout helper. The workflow-driven
 * part (fanoutVariantPrices → fanoutPricesWorkflow) is exercised by the partner
 * route integration tests; here we lock the shape-tolerant extractor.
 */
describe("collectVariantPriceIds", () => {
  it("reads the remapped `variant.prices[]` shape", () => {
    expect(
      collectVariantPriceIds([
        { id: "v1", prices: [{ id: "p1" }, { id: "p2" }] },
        { id: "v2", prices: [{ id: "p3" }] },
      ])
    ).toEqual(["p1", "p2", "p3"])
  })

  it("reads the raw `variant.price_set.prices[]` shape", () => {
    expect(
      collectVariantPriceIds([
        { id: "v1", price_set: { prices: [{ id: "p1" }] } },
      ])
    ).toEqual(["p1"])
  })

  it("prefers `prices` when both shapes are present", () => {
    expect(
      collectVariantPriceIds([
        { id: "v1", prices: [{ id: "p1" }], price_set: { prices: [{ id: "px" }] } },
      ])
    ).toEqual(["p1"])
  })

  it("tolerates null / empty / missing price rows", () => {
    expect(collectVariantPriceIds(null)).toEqual([])
    expect(collectVariantPriceIds(undefined)).toEqual([])
    expect(collectVariantPriceIds([{ id: "v1" }, { id: "v2", prices: [] }])).toEqual([])
    expect(
      collectVariantPriceIds([{ prices: [{ id: "p1" }, { amount: 5 }] }])
    ).toEqual(["p1"])
  })
})

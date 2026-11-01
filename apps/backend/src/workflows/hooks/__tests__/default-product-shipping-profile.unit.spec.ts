/**
 * #1982 — a product created without a shipping profile gets one, so it can be
 * checked out and fulfilled. A product that already has one is left alone.
 */
let handler: (input: any, ctx: any) => Promise<any>
let compensate: (data: any, ctx: any) => Promise<any>

jest.mock("@medusajs/medusa/core-flows", () => ({
  createProductsWorkflow: {
    hooks: {
      productsCreated: (fn: any, comp: any) => {
        handler = fn
        compensate = comp
      },
    },
  },
}))

jest.mock("@medusajs/framework/workflows-sdk", () => ({
  StepResponse: class {
    constructor(public output: any, public compensateInput: any) {}
  },
}))

const resolveHouseSalesChannelId = jest.fn()
const resolveShippingProfileIdForSide = jest.fn()
jest.mock("../../../lib/partner-shipping-profile", () => ({
  resolveHouseSalesChannelId: (...a: any[]) => resolveHouseSalesChannelId(...a),
  resolveShippingProfileIdForSide: (...a: any[]) => resolveShippingProfileIdForSide(...a),
}))

import "../default-product-shipping-profile"

function makeContainer(rows: any[]) {
  const link = { create: jest.fn(), dismiss: jest.fn() }
  const query = { graph: jest.fn().mockResolvedValue({ data: rows }) }
  const container = {
    resolve: (key: string) => (key === "link" ? link : key === "query" ? query : undefined),
  }
  return { container, link, query }
}

describe("default-product-shipping-profile hook", () => {
  beforeEach(() => {
    resolveHouseSalesChannelId.mockResolvedValue("sc_house")
    resolveShippingProfileIdForSide.mockImplementation(async (_c: any, side: string) =>
      side === "house" ? "sp_default" : "sp_partner"
    )
  })

  it("links a profile-less product to the house profile", async () => {
    const { container, link } = makeContainer([
      { id: "prod_1", shipping_profile: null, sales_channels: [] },
    ])
    const res = await handler({ products: [{ id: "prod_1" }] }, { container })
    expect(link.create).toHaveBeenCalledWith([
      { product: { product_id: "prod_1" }, fulfillment: { shipping_profile_id: "sp_default" } },
    ])
    expect(res.compensateInput).toHaveLength(1)
  })

  it("links a partner-channel product to the partner profile", async () => {
    const { container, link } = makeContainer([
      { id: "prod_p", shipping_profile: null, sales_channels: [{ id: "sc_partner" }] },
    ])
    await handler({ products: [{ id: "prod_p" }] }, { container })
    expect(link.create).toHaveBeenCalledWith([
      { product: { product_id: "prod_p" }, fulfillment: { shipping_profile_id: "sp_partner" } },
    ])
  })

  it("writes nothing when every product already has a profile", async () => {
    const { container, link } = makeContainer([
      { id: "prod_1", shipping_profile: { id: "sp_default" }, sales_channels: [] },
    ])
    await handler({ products: [{ id: "prod_1" }] }, { container })
    expect(link.create).not.toHaveBeenCalled()
  })

  it("compensation dismisses exactly the links it wrote", async () => {
    const { container, link } = makeContainer([])
    const links = [{ product: { product_id: "prod_1" }, fulfillment: { shipping_profile_id: "sp_default" } }]
    await compensate(links, { container })
    expect(link.dismiss).toHaveBeenCalledWith(links)
  })
})

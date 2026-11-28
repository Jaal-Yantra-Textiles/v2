import {
  PRODUCT_PAGE_ROUTE,
  revalidateProductStorefronts,
  storefrontOriginsFor,
} from "../revalidate-product-storefronts"

const containerWith = (products: any[], stores: any[]) => {
  const graph = jest.fn(async ({ entity }: any) => ({
    data: entity === "product" ? products : stores,
  }))
  return { container: { resolve: () => ({ graph }) }, graph }
}

describe("revalidateProductStorefronts", () => {
  const OLD_ENV = process.env
  let fetchMock: jest.Mock

  beforeEach(() => {
    process.env = { ...OLD_ENV, STOREFRONT_REVALIDATE_SECRET: "sek" }
    fetchMock = jest.fn(async () => ({ ok: true, status: 200 }))
    ;(global as any).fetch = fetchMock
  })
  afterEach(() => {
    process.env = OLD_ENV
  })

  it("prefers a verified custom domain and dedupes origins", () => {
    expect(
      storefrontOriginsFor([
        { partner: { storefront_domain: "gof-asia.cicilabel.com", custom_domain: "gof.asia", custom_domain_verified: true } },
        { partner: { storefront_domain: "gof-asia.cicilabel.com", custom_domain: "gof.asia", custom_domain_verified: true } },
        { partner: { storefront_domain: "x.cicilabel.com", custom_domain: "x.com", custom_domain_verified: false } },
        { partner: null },
        null,
      ])
    ).toEqual(["https://gof.asia", "https://x.cicilabel.com"])
  })

  it("POSTs the product-page route to each partner storefront with the secret", async () => {
    const { container, graph } = containerWith(
      [{ id: "prod_1", sales_channels: [{ id: "sc_gof" }, { id: "sc_main" }] }],
      [{ partner: { storefront_domain: "gof-asia.cicilabel.com", custom_domain: "gof.asia", custom_domain_verified: true } }]
    )
    const out = await revalidateProductStorefronts(container, ["prod_1", "prod_1"])

    expect(graph.mock.calls[1][0].filters).toEqual({ default_sales_channel_id: ["sc_gof", "sc_main"] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://gof.asia/api/revalidate")
    expect(init.headers["x-revalidate-secret"]).toBe("sek")
    expect(JSON.parse(init.body).paths).toEqual([PRODUCT_PAGE_ROUTE])
    expect(out).toEqual([{ origin: "https://gof.asia", outcome: expect.objectContaining({ ok: true }) }])
  })

  it("does nothing for a product only on our own shop", async () => {
    const { container } = containerWith([{ id: "p", sales_channels: [{ id: "sc_main" }] }], [])
    expect(await revalidateProductStorefronts(container, ["p"])).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never throws when the lookup fails", async () => {
    const container = { resolve: () => ({ graph: async () => { throw new Error("db down") } }) }
    await expect(revalidateProductStorefronts(container, ["p"])).resolves.toEqual([])
  })
})

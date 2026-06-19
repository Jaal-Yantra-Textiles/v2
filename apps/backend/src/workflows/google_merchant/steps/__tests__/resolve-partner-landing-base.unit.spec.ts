import {
  normalizeLandingBase,
  partnerBaseFromRecord,
  resolvePartnerLandingBase,
  resolvePartnerStorefrontForSalesChannel,
} from "../resolve-partner-landing-base"

/**
 * #377 — Google Merchant landing URL derived from the owning partner
 * storefront. Pure precedence + the product→store→partner pivot, exercised
 * with a stubbed query.graph so no DB is needed.
 */
describe("normalizeLandingBase", () => {
  it("prefixes https:// for bare domains and strips trailing slash", () => {
    expect(normalizeLandingBase("gof.asia")).toBe("https://gof.asia")
    expect(normalizeLandingBase("acme.cicilabel.com/")).toBe("https://acme.cicilabel.com")
  })

  it("keeps an explicit scheme", () => {
    expect(normalizeLandingBase("http://shop.test")).toBe("http://shop.test")
    expect(normalizeLandingBase("https://shop.test/")).toBe("https://shop.test")
  })

  it("returns null for empty/whitespace/nullish", () => {
    expect(normalizeLandingBase(undefined)).toBeNull()
    expect(normalizeLandingBase(null)).toBeNull()
    expect(normalizeLandingBase("")).toBeNull()
    expect(normalizeLandingBase("   ")).toBeNull()
  })
})

describe("partnerBaseFromRecord precedence", () => {
  it("prefers metadata.custom_domain", () => {
    expect(
      partnerBaseFromRecord({
        storefront_domain: "acme.cicilabel.com",
        metadata: { custom_domain: "shop.acme.com", website_domain: "alt.acme.com" },
      })
    ).toBe("https://shop.acme.com")
  })

  it("falls back to website_domain then storefront_domain", () => {
    expect(
      partnerBaseFromRecord({
        storefront_domain: "acme.cicilabel.com",
        metadata: { website_domain: "alt.acme.com" },
      })
    ).toBe("https://alt.acme.com")
    expect(
      partnerBaseFromRecord({ storefront_domain: "acme.cicilabel.com", metadata: {} })
    ).toBe("https://acme.cicilabel.com")
  })

  it("returns null when no domain present", () => {
    expect(partnerBaseFromRecord({ storefront_domain: null, metadata: {} })).toBeNull()
    expect(partnerBaseFromRecord(null)).toBeNull()
  })
})

describe("resolvePartnerLandingBase pivot", () => {
  const makeQuery = (responses: Record<string, any[]>) => ({
    graph: jest.fn(async ({ entity }: any) => ({ data: responses[entity] ?? [] })),
  })

  it("resolves product → sales_channel → store → partner domain", async () => {
    const query = makeQuery({
      product: [{ id: "prod_1", sales_channels: [{ id: "sc_1" }] }],
      stores: [{ id: "store_1", default_sales_channel_id: "sc_1" }],
      partners: [
        { id: "par_x", storefront_domain: "x.cicilabel.com", metadata: {}, stores: [{ id: "store_z" }] },
        {
          id: "par_1",
          storefront_domain: "acme.cicilabel.com",
          metadata: { custom_domain: "shop.acme.com" },
          stores: [{ id: "store_1" }],
        },
      ],
    })
    await expect(resolvePartnerLandingBase(query as any, "prod_1")).resolves.toBe(
      "https://shop.acme.com"
    )
  })

  it("returns null when product has no sales channel", async () => {
    const query = makeQuery({ product: [{ id: "prod_1", sales_channels: [] }] })
    await expect(resolvePartnerLandingBase(query as any, "prod_1")).resolves.toBeNull()
  })

  it("returns null when no store owns the channel", async () => {
    const query = makeQuery({
      product: [{ id: "prod_1", sales_channels: [{ id: "sc_1" }] }],
      stores: [],
    })
    await expect(resolvePartnerLandingBase(query as any, "prod_1")).resolves.toBeNull()
  })

  it("returns null when no partner owns the store", async () => {
    const query = makeQuery({
      product: [{ id: "prod_1", sales_channels: [{ id: "sc_1" }] }],
      stores: [{ id: "store_1", default_sales_channel_id: "sc_1" }],
      partners: [{ id: "par_x", storefront_domain: "x.cicilabel.com", metadata: {}, stores: [{ id: "store_z" }] }],
    })
    await expect(resolvePartnerLandingBase(query as any, "prod_1")).resolves.toBeNull()
  })

  it("never throws — swallows query errors to null", async () => {
    const query = {
      graph: jest.fn(async () => {
        throw new Error("boom")
      }),
    }
    await expect(resolvePartnerLandingBase(query as any, "prod_1")).resolves.toBeNull()
  })
})

describe("resolvePartnerStorefrontForSalesChannel pivot (#521)", () => {
  const makeQuery = (responses: Record<string, any[]>) => ({
    graph: jest.fn(async ({ entity }: any) => ({ data: responses[entity] ?? [] })),
  })

  it("resolves sales_channel → store → partner identity + base", async () => {
    const query = makeQuery({
      stores: [{ id: "store_1", default_sales_channel_id: "sc_1" }],
      partners: [
        { id: "par_x", name: "X", handle: "x", storefront_domain: "x.cicilabel.com", metadata: {}, stores: [{ id: "store_z" }] },
        {
          id: "par_1",
          name: "Acme",
          handle: "acme",
          storefront_domain: "acme.cicilabel.com",
          metadata: { custom_domain: "shop.acme.com" },
          stores: [{ id: "store_1" }],
        },
      ],
    })
    await expect(
      resolvePartnerStorefrontForSalesChannel(query as any, "sc_1")
    ).resolves.toEqual({
      id: "par_1",
      name: "Acme",
      handle: "acme",
      storefront_base: "https://shop.acme.com",
    })
  })

  it("returns null storefront_base when partner has no domain but still returns identity", async () => {
    const query = makeQuery({
      stores: [{ id: "store_1", default_sales_channel_id: "sc_1" }],
      partners: [
        { id: "par_1", name: "Acme", handle: "acme", storefront_domain: null, metadata: {}, stores: [{ id: "store_1" }] },
      ],
    })
    await expect(
      resolvePartnerStorefrontForSalesChannel(query as any, "sc_1")
    ).resolves.toEqual({ id: "par_1", name: "Acme", handle: "acme", storefront_base: null })
  })

  it("returns null when no sales_channel_id is given", async () => {
    const query = makeQuery({})
    await expect(
      resolvePartnerStorefrontForSalesChannel(query as any, null)
    ).resolves.toBeNull()
    expect((query.graph as jest.Mock).mock.calls.length).toBe(0)
  })

  it("returns null when no store owns the channel", async () => {
    const query = makeQuery({ stores: [] })
    await expect(
      resolvePartnerStorefrontForSalesChannel(query as any, "sc_1")
    ).resolves.toBeNull()
  })

  it("returns null when no partner owns the store", async () => {
    const query = makeQuery({
      stores: [{ id: "store_1", default_sales_channel_id: "sc_1" }],
      partners: [{ id: "par_x", name: "X", handle: "x", storefront_domain: "x.cicilabel.com", metadata: {}, stores: [{ id: "store_z" }] }],
    })
    await expect(
      resolvePartnerStorefrontForSalesChannel(query as any, "sc_1")
    ).resolves.toBeNull()
  })

  it("never throws — swallows query errors to null", async () => {
    const query = {
      graph: jest.fn(async () => {
        throw new Error("boom")
      }),
    }
    await expect(
      resolvePartnerStorefrontForSalesChannel(query as any, "sc_1")
    ).resolves.toBeNull()
  })
})

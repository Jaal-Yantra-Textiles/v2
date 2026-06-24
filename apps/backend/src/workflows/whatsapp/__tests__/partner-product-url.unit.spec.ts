import { buildPartnerProductUrl } from "../partner-product-url"

describe("buildPartnerProductUrl", () => {
  const ORIGINAL = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  it("uses an explicit base + partner product-detail path", () => {
    expect(
      buildPartnerProductUrl("prod_123", "https://partner.jaalyantra.com")
    ).toBe("https://partner.jaalyantra.com/products/prod_123")
  })

  it("trims a trailing slash from the base", () => {
    expect(
      buildPartnerProductUrl("prod_123", "https://partner.jaalyantra.com/")
    ).toBe("https://partner.jaalyantra.com/products/prod_123")
  })

  it("falls back to PARTNER_APP_URL when no base is given", () => {
    delete process.env.PARTNER_PORTAL_URL
    process.env.PARTNER_APP_URL = "https://app.example.com"
    expect(buildPartnerProductUrl("prod_9")).toBe(
      "https://app.example.com/products/prod_9"
    )
  })

  it("falls back to PARTNER_PORTAL_URL when PARTNER_APP_URL is unset", () => {
    delete process.env.PARTNER_APP_URL
    process.env.PARTNER_PORTAL_URL = "https://portal.example.com"
    expect(buildPartnerProductUrl("prod_9")).toBe(
      "https://portal.example.com/products/prod_9"
    )
  })

  it("defaults to partner.jaalyantra.com when nothing is configured", () => {
    delete process.env.PARTNER_APP_URL
    delete process.env.PARTNER_PORTAL_URL
    expect(buildPartnerProductUrl("prod_x")).toBe(
      "https://partner.jaalyantra.com/products/prod_x"
    )
  })

  it("ignores the admin base (MEDUSA_BACKEND_URL) entirely", () => {
    delete process.env.PARTNER_APP_URL
    delete process.env.PARTNER_PORTAL_URL
    process.env.MEDUSA_BACKEND_URL = "https://v3.jaalyantra.com"
    const url = buildPartnerProductUrl("prod_x")
    expect(url).not.toContain("v3.jaalyantra.com")
    expect(url).not.toContain("/app/products")
    expect(url).toBe("https://partner.jaalyantra.com/products/prod_x")
  })
})

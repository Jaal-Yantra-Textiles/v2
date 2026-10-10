import { ADMIN_MCP_TOOLS } from "../registry"

/**
 * update_product could set a thumbnail but not the gallery, so a product whose
 * photos browsers cannot show (HEIC, the Tangaliya skirt) had no way to be
 * repointed at JPEG copies (2026-10-10).
 */
describe("update_product images", () => {
  const t = () => (ADMIN_MCP_TOOLS as any[]).find((x) => x.name === "update_product")

  it("🔴 forwards images to the product route", () => {
    expect(t().bodyParams).toContain("images")
  })

  it("warns the model that the list replaces the gallery", () => {
    expect(t().inputSchema.properties.images.description).toMatch(/REPLACES/)
  })
})

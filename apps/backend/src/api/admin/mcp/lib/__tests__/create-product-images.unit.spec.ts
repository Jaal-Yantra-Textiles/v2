import { ADMIN_MCP_TOOLS } from "../registry"

/**
 * `create_product` images must be advertised as `[{ url }]`.
 *
 * The schema used to say `items: { type: "string" }` ("array of image URLs"),
 * so a caller following it sent bare strings and core's POST /admin/products
 * refused the whole product: "Field 'images, 0' is required". Found on
 * 2026-11-02 creating the Balloon Pant draft. `update_product` already used
 * the object shape; the two now agree.
 */
const imagesSchema = (name: string) =>
  (ADMIN_MCP_TOOLS.find((t) => t.name === name)?.inputSchema as any)?.properties?.images

describe("create_product images shape", () => {
  it("advertises images as objects carrying a url", () => {
    const images = imagesSchema("create_product")
    expect(images?.type).toBe("array")
    expect(images?.items?.type).toBe("object")
    expect(images?.items?.required).toEqual(["url"])
  })

  it("matches update_product's image shape", () => {
    expect(imagesSchema("create_product")?.items?.type).toBe(imagesSchema("update_product")?.items?.type)
  })

  it("still forwards images to core", () => {
    expect(ADMIN_MCP_TOOLS.find((t) => t.name === "create_product")?.bodyParams).toContain("images")
  })
})

import { ADMIN_MCP_TOOLS } from "../registry"

/**
 * No tool could put a product in a second sales channel, and the one that
 * looked able to — bulk_update_products with `sales_channels` — drops the
 * field (it is not in PRODUCT_FIELDS) and reports success. Found listing our
 * Tangaliya skirt on Tangaliya House's store (2026-10-10).
 */
const tool = (name: string) => {
  const found = (ADMIN_MCP_TOOLS as any[]).find((t) => t.name === name)
  if (!found) {
    throw new Error(`tool ${name} is not registered`)
  }
  return found
}

describe("set_sales_channel_products", () => {
  const t = () => tool("set_sales_channel_products")

  it("🔴 forwards add and remove to Medusa's sales-channel products route", () => {
    expect(t().method).toBe("POST")
    expect(t().path).toBe("/admin/sales-channels/:id/products")
    expect(t().bodyParams).toEqual(expect.arrayContaining(["add", "remove"]))
  })

  it("is sensitive, because it changes what a storefront sells", () => {
    expect(t().sensitive).toBe(true)
  })
})

import { ADMIN_MCP_TOOLS } from "../registry"

/**
 * A partner storefront's logo, store name and home page live ONLY in
 * `website.theme`. Before these tools, no admin surface could write it: the
 * partner's own login was the only door, `update_partner`'s `logo` never
 * reaches the storefront nav, and `PUT /admin/websites/:id` strips `theme`.
 * Found setting up Shramdaan's storefront (#2061, 2026-10-10).
 */
const tool = (name: string) => {
  const found = (ADMIN_MCP_TOOLS as any[]).find((t) => t.name === name)
  if (!found) {
    throw new Error(`tool ${name} is not registered`)
  }
  return found
}

describe("update_partner_storefront_theme", () => {
  const t = () => tool("update_partner_storefront_theme")

  it("🔴 forwards the sections a storefront home page is built from", () => {
    expect(t().bodyParams).toEqual(
      expect.arrayContaining(["branding", "hero", "home_sections"])
    )
  })

  it("writes through the admin theme route, behind confirm", () => {
    expect(t().method).toBe("PUT")
    expect(t().path).toBe("/admin/partners/:id/storefront/website/theme")
    expect(t().sensitive).toBe(true)
  })

  it("tells the model the nav logo lives here, not on the partner", () => {
    expect(t().description).toMatch(/branding\.logo_url/)
  })
})

describe("get_partner_storefront_website", () => {
  it("reads the theme from the existing admin read-proxy", () => {
    const t = tool("get_partner_storefront_website")
    expect(t.method).toBe("GET")
    expect(t.path).toBe("/admin/partners/:id/storefront/website")
    expect(t.write).toBeFalsy()
  })
})

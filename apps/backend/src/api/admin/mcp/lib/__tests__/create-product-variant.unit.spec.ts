import { ADMIN_MCP_TOOLS } from "../registry"
import { isSensitive } from "../../../../../lib/mcp-core"

/**
 * `create_product_variant` — adding a variant to a product that already exists.
 *
 * The gap this fills was found in live use: a partner's Kala Cotton needed a
 * 33s count and their Linen a 40 lea, and the admin MCP could not make either.
 * `create_product` builds a whole new product (wrong parent), and
 * `update_product_variant` can only edit a variant that is already there — so
 * the only route was the dashboard.
 *
 * The failure mode worth pinning is #1348's: `bodyParams` is the dispatcher's
 * forward list, and a field the schema advertises but the list omits is
 * STRIPPED IN SILENCE. Here the droppable fields are `options` and `prices` —
 * lose `options` and the variant is created against the wrong option value;
 * lose `prices` and it is created unsellable. Neither says anything at the
 * time.
 */
const tool = ADMIN_MCP_TOOLS.find((t) => t.name === "create_product_variant")

describe("create_product_variant", () => {
  it("is registered", () => {
    expect(tool).toBeTruthy()
  })

  it("POSTs to the product's variants collection", () => {
    // Core's route is POST /admin/products/:id/variants — a variant is created
    // UNDER a product, never at a top-level /admin/variants.
    expect(tool?.method).toBe("POST")
    expect(tool?.path).toBe("/admin/products/:product_id/variants")
    expect(tool?.pathParams).toEqual(["product_id"])
  })

  it("is a sensitive write — it changes a live catalogue", () => {
    expect(tool?.write).toBe(true)
    expect(isSensitive(tool as any)).toBe(true)
  })

  describe("the forward list is a contract with the schema", () => {
    const schemaProps = Object.keys((tool?.inputSchema as any)?.properties ?? {})
    const forwarded = new Set(tool?.bodyParams ?? [])

    it("forwards every field the schema advertises, minus the path param", () => {
      const stripped = schemaProps
        .filter((k) => !(tool?.pathParams ?? []).includes(k))
        .filter((k) => !forwarded.has(k))

      // Each entry here is a field the tool INVITES a caller to send, then drops.
      expect(stripped).toEqual([])
    })

    it("advertises every field it forwards — no invisible parameters", () => {
      const undocumented = [...forwarded].filter((k) => !schemaProps.includes(k))
      expect(undocumented).toEqual([])
    })

    it("carries options and prices, the two whose loss is silent", () => {
      expect(forwarded.has("options")).toBe(true)
      expect(forwarded.has("prices")).toBe(true)
    })

    it("carries manage_inventory, which decides whether stock can ever be tracked", () => {
      // Core only ever turns tracking OFF for an existing variant, so the value
      // chosen at creation is effectively permanent.
      expect(forwarded.has("manage_inventory")).toBe(true)
    })
  })

  it("requires only the parent product and a title", () => {
    expect((tool?.inputSchema as any)?.required).toEqual(["product_id", "title"])
  })

  it("warns that an option value must already exist on the product", () => {
    // The trap: core matches a variant to EXISTING option values and will not
    // invent one, so a genuinely new count/size needs the product option
    // extended first. Silent enough to be worth saying in the description.
    expect(tool?.description).toMatch(/already/i)
    expect(tool?.description).toMatch(/option/i)
  })

  it("says which sibling tool to use instead, in both directions", () => {
    expect(tool?.description).toMatch(/create_product\b/)
    expect(tool?.description).toMatch(/update_product_variant/)
  })

  it("does not collide with update_product_variant", () => {
    const update = ADMIN_MCP_TOOLS.find((t) => t.name === "update_product_variant")
    expect(update).toBeTruthy()
    expect(update?.path).not.toBe(tool?.path)
  })
})

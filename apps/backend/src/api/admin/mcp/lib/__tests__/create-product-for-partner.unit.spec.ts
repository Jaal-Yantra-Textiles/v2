import { ADMIN_MCP_TOOLS } from "../registry"
import { isSensitive } from "../../../../../lib/mcp-core"

/**
 * `create_product_for_partner` — an admin creating a product inside someone
 * else's live shop.
 *
 * Two failure modes are worth pinning. The first is #1348's: `bodyParams` is
 * the dispatcher's forward list, so any field the schema advertises but the
 * list omits is silently STRIPPED — and here the droppable fields are
 * `variants` and their prices, whose loss is invisible until a customer finds
 * an unbuyable product on a partner's storefront. The second is authority: the
 * route derives the sales channel from the store, and a caller that could pass
 * its own would be able to create a product into one partner's store pointing
 * at another's.
 */
const tool = ADMIN_MCP_TOOLS.find((t) => t.name === "create_product_for_partner")

describe("create_product_for_partner", () => {
  it("is registered", () => {
    expect(tool).toBeTruthy()
  })

  it("targets the store-scoped route, not core /admin/products", () => {
    // Core /admin/products binds no sales channel and seeds no inventory
    // levels — the product is invisible and reads 0 stock everywhere.
    expect(tool?.method).toBe("POST")
    expect(tool?.path).toBe("/admin/stores/:id/products")
    expect(tool?.pathParams).toEqual(["id"])
  })

  it("is a sensitive write — it publishes into someone else's business", () => {
    expect(tool?.write).toBe(true)
    expect(isSensitive(tool as any)).toBe(true)
  })

  describe("the forward list is a contract with the schema", () => {
    const schemaProps = Object.keys(
      (tool?.inputSchema as any)?.properties ?? {}
    )
    const forwarded = new Set(tool?.bodyParams ?? [])

    it("forwards every field the schema advertises, minus the path param", () => {
      const stripped = schemaProps
        .filter((k) => !(tool?.pathParams ?? []).includes(k))
        .filter((k) => !forwarded.has(k))

      // A field here is one the tool INVITES a caller to send and then drops.
      expect(stripped).toEqual([])
    })

    it("advertises every field it forwards — no invisible parameters", () => {
      const undocumented = [...forwarded].filter(
        (k) => !schemaProps.includes(k)
      )
      expect(undocumented).toEqual([])
    })

    it("carries variants and prices, the fields whose loss is invisible", () => {
      expect(forwarded.has("variants")).toBe(true)
      expect(forwarded.has("options")).toBe(true)
      expect(forwarded.has("images")).toBe(true)
    })

    it("does NOT let a caller choose the sales channel", () => {
      // The route derives it from the store. Accepting one would allow a
      // product to be created into one partner's store while listing in
      // another's channel.
      expect(forwarded.has("sales_channels")).toBe(false)
      expect(schemaProps).not.toContain("sales_channels")
    })
  })

  it("requires the store and a title, and nothing else", () => {
    expect((tool?.inputSchema as any)?.required).toEqual(["id", "title"])
  })

  it("points the caller at the spec tool next — the two are separate writes", () => {
    // Made-to-order choices are spec option groups, not product options.
    expect(tool?.nextSteps).toContain("set_product_spec")
  })

  it("says out loud that it records and announces the act", () => {
    expect(tool?.sideEffects).toMatch(/ownership link|records/i)
    expect(tool?.sideEffects).toContain("product.created_for_partner")
  })
})

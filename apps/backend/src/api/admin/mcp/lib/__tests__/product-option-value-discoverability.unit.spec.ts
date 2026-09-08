import { ADMIN_MCP_TOOLS } from "../registry"
import { toolDomain } from "../tool-slice"

/**
 * #1894 follow-up — `create_product_variant` matches a variant to option values
 * that already exist and core will not invent one, so a variant naming a new
 * value cannot be created at all unless some tool can add that value first.
 *
 * That gap has the same shape as the stock-location one in #1893: nothing
 * errors and no schema is wrong, the caller simply cannot begin. It cost two
 * live order lines — a 33s Kala Cotton and a 40 lea Linen — that could not be
 * added to a pending inventory order through the MCP at all.
 *
 * These pin the RULE, so the next tool that depends on an option value inherits
 * the guarantee instead of re-finding the hole.
 */
const byName = (n: string) => ADMIN_MCP_TOOLS.find((t) => t.name === n)

describe("product option values are reachable (#1894)", () => {
  it("a tool exists that can add a value to a product option", () => {
    const tool = byName("update_product_option")
    expect(tool).toBeDefined()
    expect(tool!.write).toBe(true)
    expect(tool!.sensitive).toBe(true)
  })

  it("forwards `values` — a body param the schema advertises but the forward list omits is stripped in silence", () => {
    const tool = byName("update_product_option")!
    const advertised = Object.keys(
      (tool.inputSchema as any).properties ?? {}
    ).filter((k) => !(tool.pathParams ?? []).includes(k))

    for (const key of advertised) {
      expect(tool.bodyParams).toContain(key)
    }
  })

  it("shares a slice with the variant tool it unblocks, or it loads in no slice", () => {
    const creator = byName("create_product_variant")!
    const option = byName("update_product_option")!

    const optionDomain = toolDomain(option)
    expect(optionDomain).toBeTruthy()
    expect(optionDomain).toBe(toolDomain(creator))
  })

  it("names create_product_variant as the next step, so the blocked caller is told where to go", () => {
    expect(byName("update_product_option")!.nextSteps).toContain(
      "create_product_variant"
    )
  })

  it("warns that values REPLACES rather than appends — the trap that destroys existing variants' options", () => {
    const d = byName("update_product_option")!.description
    expect(d).toMatch(/REPLACES/)
    expect(d).toMatch(/not an append/i)
  })
})

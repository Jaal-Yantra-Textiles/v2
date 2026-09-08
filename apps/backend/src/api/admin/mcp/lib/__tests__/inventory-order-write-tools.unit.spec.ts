import { ADMIN_MCP_TOOLS } from "../registry"
import { isSensitive } from "../../../../../lib/mcp-core"

/**
 * The two inventory-order writes the MCP could not do.
 *
 * Found in live use: an order was created through `create_inventory_order` with
 * the wrong per-metre dye charge and against no partner. Neither could be put
 * right from here — `update_order` is the CORE order tool ('order_...') and
 * silently targets a different entity, and nothing exposed
 * `/assign-partner`. So the order sat with wrong money on it, billable to
 * nobody.
 *
 * As with every registry row, `bodyParams` is the dispatcher's forward list: a
 * field the schema advertises and the list omits is stripped in silence. Here
 * that would mean an update that appears to succeed and changes nothing.
 */
const update = ADMIN_MCP_TOOLS.find((t) => t.name === "update_inventory_order_lines")
const assign = ADMIN_MCP_TOOLS.find((t) => t.name === "assign_inventory_order_partner")

const contract = (tool: any, label: string) => {
  describe(`${label}: the forward list is a contract with the schema`, () => {
    const schemaProps = Object.keys(tool?.inputSchema?.properties ?? {})
    const forwarded = new Set<string>(tool?.bodyParams ?? [])

    it("forwards every field the schema advertises, minus the path params", () => {
      const stripped = schemaProps
        .filter((k) => !(tool?.pathParams ?? []).includes(k))
        .filter((k) => !forwarded.has(k))
      expect(stripped).toEqual([])
    })

    it("advertises every field it forwards", () => {
      expect([...forwarded].filter((k) => !schemaProps.includes(k))).toEqual([])
    })
  })
}

describe("update_inventory_order_lines", () => {
  it("is registered", () => {
    expect(update).toBeTruthy()
  })

  it("PUTs the order-lines collection of ONE inventory order", () => {
    expect(update?.method).toBe("PUT")
    expect(update?.path).toBe("/admin/inventory-orders/:id/order-lines")
    expect(update?.pathParams).toEqual(["id"])
  })

  it("is a sensitive write", () => {
    expect(update?.write).toBe(true)
    expect(isSensitive(update as any)).toBe(true)
  })

  it("carries extra_cost — the per-unit dye charge that prompted this", () => {
    const line = (update?.inputSchema as any)?.properties?.order_lines?.items?.properties
    expect(line?.extra_cost).toBeTruthy()
    expect(line?.price).toBeTruthy()
    expect(line?.quantity).toBeTruthy()
  })

  it("can add a line by variant as well as by inventory item", () => {
    const line = (update?.inputSchema as any)?.properties?.order_lines?.items?.properties
    expect(line?.variant_id).toBeTruthy()
    expect(line?.inventory_item_id).toBeTruthy()
  })

  it("can remove a line", () => {
    const line = (update?.inputSchema as any)?.properties?.order_lines?.items?.properties
    expect(line?.remove).toBeTruthy()
  })

  it("says the array is the desired final state, not a patch", () => {
    // Sending only the line you meant to change would delete the others.
    expect(update?.description).toMatch(/final state/i)
  })

  it("warns that the order totals are NOT recomputed", () => {
    // The silent failure: lines updated, `total_price` left stale, and the
    // order then disagrees with the sum of its own lines.
    expect(update?.description).toMatch(/not recomputed/i)
    expect(update?.description).toMatch(/total_price/)
  })

  it("requires the order id and the lines", () => {
    expect((update?.inputSchema as any)?.required).toEqual(["id", "order_lines"])
  })

  contract(update, "update_inventory_order_lines")
})

describe("assign_inventory_order_partner", () => {
  it("is registered", () => {
    expect(assign).toBeTruthy()
  })

  it("POSTs the assign-partner route for one order", () => {
    expect(assign?.method).toBe("POST")
    expect(assign?.path).toBe("/admin/inventory-orders/:id/assign-partner")
    expect(assign?.pathParams).toEqual(["id"])
  })

  it("is a sensitive write — it decides whose payables the order lands in", () => {
    expect(assign?.write).toBe(true)
    expect(isSensitive(assign as any)).toBe(true)
  })

  it("says what an unassigned order costs you", () => {
    // The consequence is invisible: the order looks fine and simply never
    // appears in the partner's payables.
    expect(assign?.description).toMatch(/payable/i)
  })

  it("requires both ids", () => {
    expect((assign?.inputSchema as any)?.required).toEqual(["id", "partner_id"])
  })

  contract(assign, "assign_inventory_order_partner")
})

describe("the inventory-order tools are distinct from the core order tools", () => {
  it("does not reuse update_order, which targets a core order", () => {
    const core = ADMIN_MCP_TOOLS.find((t) => t.name === "update_order")
    expect(core?.path).toBe("/admin/orders/:id")
    expect(update?.path).not.toBe(core?.path)
  })
})

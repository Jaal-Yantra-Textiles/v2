import { ADMIN_MCP_TOOLS } from "../registry"
import { toolDomain } from "../tool-slice"

/**
 * A tool that DEMANDS an identifier must be reachable from a tool that
 * PRODUCES it.
 *
 * Five admin tools took a `stock_location_id` and nothing in the registry
 * listed one. That gap is invisible in the worst way: no tool errors, no
 * schema is wrong, the caller simply cannot begin — the only way to supply the
 * id was to be handed it out of band. It surfaced when an inventory order was
 * created with its supplier's warehouse as the DESTINATION and the correction
 * could not be made through the MCP at all.
 *
 * This spec pins the general rule rather than the two new rows, so the next
 * tool that asks for a location id inherits the guarantee instead of
 * re-discovering the hole.
 */

const byName = new Map(ADMIN_MCP_TOOLS.map((t) => [t.name, t]))

/** Every property name a tool's input schema declares, at the top level. */
const schemaProps = (tool: any): string[] =>
  Object.keys(tool?.inputSchema?.properties ?? {})

describe("stock locations are discoverable", () => {
  it("exposes a list tool and a get tool", () => {
    expect(byName.has("list_stock_locations")).toBe(true)
    expect(byName.has("get_stock_location")).toBe(true)
  })

  it("keeps them READ tools — a location is looked up, never edited here", () => {
    for (const name of ["list_stock_locations", "get_stock_location"]) {
      const tool: any = byName.get(name)
      expect(tool.method).toBe("GET")
      expect(tool.write).toBeUndefined()
      expect(tool.sensitive).toBeUndefined()
    }
  })

  it("classifies both into the inventory slice", () => {
    // An unclassified tool loads in NO slice, so it may as well not exist —
    // it would be present in the registry and unreachable from every ask.
    expect(toolDomain(byName.get("list_stock_locations")!)).toBe("inventory")
    expect(toolDomain(byName.get("get_stock_location")!)).toBe("inventory")
  })

  it("THE RULE: every tool asking for a stock_location_id has a discovery tool beside it", () => {
    const askers = ADMIN_MCP_TOOLS.filter((t) =>
      schemaProps(t).some((p) => /(^|_)stock_location_id$/.test(p))
    ).map((t) => t.name)

    // Guards the guard: if this ever finds nothing, the regex has drifted and
    // every assertion below would pass over an empty list.
    expect(askers.length).toBeGreaterThan(0)
    expect(askers).toContain("create_inventory_order")

    // The discovery tool must be in the SAME domain as each asker, or a sliced
    // ask that surfaces the asker will not surface the way to answer it.
    const discoveryDomain = toolDomain(byName.get("list_stock_locations")!)
    const unreachable = askers.filter(
      (name) => toolDomain(byName.get(name)!) !== discoveryDomain
    )

    expect({ askers, unreachable }).toEqual({ askers, unreachable: [] })
  })
})

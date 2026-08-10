/**
 * The image / materials / idea-to-design tools (#1238).
 *
 * These assert the two things that actually break in production: a tool that
 * exists but can never be reached (wrong domain, no keyword), and a write tool
 * that isn't gated. Both fail silently — the model just says it can't do it.
 */
import { ADMIN_MCP_TOOLS } from "../registry"
import {
  selectAdminToolSlice,
  toolDomain,
  matchDomains,
} from "../tool-slice"

const byName = (name: string) => {
  const def = ADMIN_MCP_TOOLS.find((t) => t.name === name)
  if (!def) {
    throw new Error(`tool ${name} is not registered`)
  }
  return def
}

const NEW_TOOLS = [
  "read_image",
  "extract_inventory_from_image",
  "list_raw_materials",
  "add_inventory_raw_material",
  "list_raw_material_groups",
  "create_raw_material_group",
  "link_design_inventory",
  "list_design_material_groups",
  "link_design_material_group",
  "list_construction_techniques",
  "list_design_construction_details",
  "add_design_construction_detail",
  "update_design_brief",
  "search_pinterest",
]

describe("registry — image, materials and design tools", () => {
  it("registers every new tool exactly once", () => {
    for (const name of NEW_TOOLS) {
      const matches = ADMIN_MCP_TOOLS.filter((t) => t.name === name)
      expect([name, matches.length]).toEqual([name, 1])
    }
  })

  it("gates everything that creates records behind write + confirm", () => {
    const mutating = [
      "extract_inventory_from_image",
      "add_inventory_raw_material",
      "create_raw_material_group",
      "link_design_inventory",
      "link_design_material_group",
      "add_design_construction_detail",
      "update_design_brief",
    ]
    for (const name of mutating) {
      const def = byName(name)
      expect([name, def.write === true, def.sensitive === true]).toEqual([
        name,
        true,
        true,
      ])
    }
  })

  it("does NOT gate reads — including read_image, which writes nothing", () => {
    for (const name of [
      "read_image",
      "list_raw_materials",
      "list_raw_material_groups",
      "list_design_material_groups",
      "list_construction_techniques",
      "list_design_construction_details",
      "search_pinterest",
    ]) {
      expect([name, !!byName(name).write]).toEqual([name, false])
    }
  })

  it("declares every :param in the path as a pathParam", () => {
    for (const name of NEW_TOOLS) {
      const def = byName(name)
      const placeholders = (def.path?.match(/:(\w+)/g) ?? []).map((p) => p.slice(1))
      expect([name, def.pathParams ?? []]).toEqual([name, placeholders])
    }
  })

  it("only forwards body params the tool's own schema declares", () => {
    for (const name of NEW_TOOLS) {
      const def = byName(name)
      const props = Object.keys(def.inputSchema?.properties ?? {})
      for (const key of def.bodyParams ?? []) {
        expect([name, key, props.includes(key)]).toEqual([name, key, true])
      }
    }
  })
})

describe("tool-slice — reachability", () => {
  it("puts read_image in core so it survives any conversation", () => {
    // An image can be attached to a conversation about anything. If read_image
    // were domain-scoped, "what does this say?" in an orders thread would find
    // no tool and the model would claim it cannot see images at all.
    expect(toolDomain(byName("read_image"))).toBe("core")

    const slice = selectAdminToolSlice(
      "how many orders shipped yesterday?",
      ADMIN_MCP_TOOLS as any
    )
    expect(slice.names).toContain("read_image")
  })

  it("classifies photo-to-inventory as inventory, not as an image feature", () => {
    expect(toolDomain(byName("extract_inventory_from_image"))).toBe("inventory")
    expect(toolDomain(byName("create_raw_material_group"))).toBe("inventory")
  })

  it("classifies Pinterest reference search with designs", () => {
    expect(toolDomain(byName("search_pinterest"))).toBe("designs")
  })

  it("lights up inventory for how an operator describes a delivery", () => {
    for (const ask of [
      "here's a photo of the swatches that arrived",
      "log these fabric rolls",
      "add the trims from this delivery note",
      "what's the composition and unit cost?",
    ]) {
      expect([ask, matchDomains(ask)]).toEqual([ask, expect.arrayContaining(["inventory"])])
    }
  })

  it("lights up designs for construction vocabulary, not just the word 'design'", () => {
    // An operator says "add a waist dart", never "add a construction detail".
    for (const ask of [
      "add a waist dart to it",
      "put a knife pleat on the skirt",
      "topstitch the hem",
      "give me a brief with the persona and price point",
    ]) {
      expect([ask, matchDomains(ask)]).toEqual([ask, expect.arrayContaining(["designs"])])
    }
  })

  it("exposes the whole idea-to-production chain for one design ask", () => {
    const slice = selectAdminToolSlice(
      "create a design from this pinterest reference, link the fabric and a partner, then start a production run",
      ADMIN_MCP_TOOLS as any
    )
    for (const name of [
      "create_design",
      "update_design_brief",
      "add_design_construction_detail",
      "link_design_inventory",
      "link_design_partners",
      "create_design_production_run",
      "search_pinterest",
    ]) {
      expect([name, slice.names.includes(name)]).toEqual([name, true])
    }
  })
})

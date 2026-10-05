/**
 * Inventory-order courier booking and colour grouping over MCP.
 *
 * Until these rows existed, every inventory-order shipment (Bhuttico wool,
 * Bhagalpur samples, HR Handloom Kala Cotton — 2026-10-04/05) was booked by
 * hand with curl, and grouping colours had to go round the MCP because
 * `add_inventory_raw_material` dropped `group_id`.
 *
 * Pinned: the forward lists match the routes' own field names (a missing
 * bodyParam is stripped in SILENCE), and the booking is confirm-gated and not
 * reachable by a write-scoped credential (it spends money with a carrier).
 */
import { rawMaterialSchema } from "../../../inventory-items/[id]/rawmaterials/validators"
import { ADMIN_MCP_TOOLS } from "../registry"
import { mcpToolTier } from "../../../../../lib/mcp-core/tiers"
import { toolDomain } from "../tool-slice"

const byName = (name: string) => ADMIN_MCP_TOOLS.find((t) => t.name === name)

describe("inventory-order shipment + colour-group tools", () => {
  it("quotes with the query names the rates route reads", () => {
    const d = byName("list_inventory_order_shipping_rates")!
    expect(d.method).toBe("GET")
    expect(d.path).toBe("/admin/inventory-orders/:id/shiprocket-rates")
    // The route reads length/breadth/height — NOT length_cm/width_cm like the
    // core-order quote. A wrong name is dropped and the box is never priced.
    expect(d.queryParams).toEqual(
      expect.arrayContaining(["weight_grams", "length", "breadth", "height"])
    )
    for (const q of d.queryParams!) {
      expect(`${q}:${q in (d.inputSchema.properties ?? {})}`).toBe(`${q}:true`)
    }
  })

  it("forwards every booking field the schema advertises", () => {
    const d = byName("create_inventory_order_shipment")!
    expect(d.path).toBe("/admin/inventory-orders/:id/shipment")
    const props = Object.keys(d.inputSchema.properties ?? {}).filter((k) => k !== "id")
    expect([...d.bodyParams!].sort()).toEqual(props.sort())
    // The route's zod reads dimensions_cm.breadth; `width` would be stripped.
    const dims = (d.inputSchema.properties as any).dimensions_cm.properties
    expect(Object.keys(dims).sort()).toEqual(["breadth", "height", "length"])
  })

  it("gates the booking behind confirm and keeps it off the write tier", () => {
    const d = byName("create_inventory_order_shipment")!
    expect(d.write).toBe(true)
    expect(d.sensitive).toBe(true)
    expect(mcpToolTier(d)).not.toBe("write")
    expect(d.sideEffects).toMatch(/costs money/)
  })

  it("links colours with the route's own body field", () => {
    const d = byName("link_raw_material_group_colors")!
    expect(d.path).toBe("/admin/raw-material-groups/:id/colors/link")
    expect(d.bodyParams).toEqual(["raw_material_ids"])
    expect(d.sensitive).toBe(true)
  })

  it("classifies all three into the inventory slice", () => {
    for (const name of [
      "list_inventory_order_shipping_rates",
      "create_inventory_order_shipment",
      "link_raw_material_group_colors",
    ]) {
      expect(`${name}:${toolDomain(byName(name)!)}`).toBe(`${name}:inventory`)
    }
  })

  it("keeps group_id when a raw material is created", () => {
    // Seen 2026-10-05: HR Handloom's Kala Cotton colours came back group_id null.
    const parsed = rawMaterialSchema.parse({
      rawMaterialData: { name: "Kala Cotton Beige", composition: "100% cotton", group_id: "grp_1" },
    })
    expect(parsed.rawMaterialData.group_id).toBe("grp_1")
  })
})

/**
 * The inventory item's own lifecycle over MCP (#1905).
 *
 * `list_inventory_items` shipped alone: a reader with no way to open one row,
 * create one, place it at a warehouse, count it, hold it or divide it. The
 * routes all existed — core's location-levels and reservations, this repo's
 * split and raw-material update — so the gap was nine missing registry rows,
 * and a gap of that shape is invisible: nothing errors, the caller simply
 * cannot start.
 *
 * What is pinned here:
 *
 *  1. `bodyParams` and the input schema agree BOTH ways. The global invariant
 *     in `dispatch.unit.spec` only checks params -> schema; the direction that
 *     actually bites is schema -> params, because a field the schema advertises
 *     and the forward list omits is stripped in SILENCE — the call succeeds and
 *     changes nothing.
 *  2. Every wrapped core route is `.strict()`, so an extra forwarded key is a
 *     400 rather than a no-op. The lists must be exactly the routes' fields.
 *  3. The writes that overwrite an absolute count carry the warning that says
 *     so. `stocked_quantity` is not a delta, and a model that assumes it is
 *     destroys stock silently.
 *  4. A tool demanding an id is reachable from one that produces it.
 */
import { ADMIN_MCP_TOOLS } from "../registry"
import { toolDomain } from "../tool-slice"

const byName = (name: string) => ADMIN_MCP_TOOLS.find((t) => t.name === name)

/** The rows this issue added, plus the create tool they complete. */
const NEW_TOOLS = [
  "get_inventory_item",
  "create_inventory_item",
  "list_inventory_levels",
  "set_inventory_level",
  "update_inventory_level",
  "list_reservations",
  "create_reservation",
  "delete_reservation",
  "split_inventory_item",
  "get_raw_material",
  "update_inventory_raw_material",
]

describe("inventory lifecycle tools (#1905)", () => {
  it("registers every tool", () => {
    for (const name of NEW_TOOLS) {
      expect(`${name}:${byName(name) ? "present" : "MISSING"}`).toBe(`${name}:present`)
    }
  })

  it("forwards exactly what each schema advertises — neither stripped nor 400", () => {
    for (const name of NEW_TOOLS) {
      const def = byName(name)!
      if (def.method === "GET" || def.method === "DELETE") {
        expect(`${name}:${JSON.stringify(def.bodyParams ?? [])}`).toBe(`${name}:[]`)
        continue
      }
      const props = Object.keys(def.inputSchema.properties ?? {})
      const pathAndQuery = new Set([
        ...(def.pathParams ?? []),
        ...(def.queryParams ?? []),
      ])
      // Everything the schema offers that is not a path/query param has to be
      // on the forward list, or the model can fill it in and nothing happens.
      const shouldForward = props.filter((p) => !pathAndQuery.has(p)).sort()
      expect(`${name}:${[...(def.bodyParams ?? [])].sort().join(",")}`).toBe(
        `${name}:${shouldForward.join(",")}`
      )
    }
  })

  it("wraps the real routes with the real methods", () => {
    expect(byName("get_inventory_item")).toMatchObject({
      method: "GET",
      path: "/admin/inventory-items/:id",
    })
    expect(byName("create_inventory_item")).toMatchObject({
      method: "POST",
      path: "/admin/inventory-items",
    })
    expect(byName("list_inventory_levels")).toMatchObject({
      method: "GET",
      path: "/admin/inventory-items/:id/location-levels",
    })
    expect(byName("set_inventory_level")).toMatchObject({
      method: "POST",
      path: "/admin/inventory-items/:id/location-levels",
    })
    // Core updates a single level with POST, not PUT/PATCH.
    expect(byName("update_inventory_level")).toMatchObject({
      method: "POST",
      path: "/admin/inventory-items/:id/location-levels/:location_id",
    })
    expect(byName("list_reservations")).toMatchObject({
      method: "GET",
      path: "/admin/reservations",
    })
    expect(byName("create_reservation")).toMatchObject({
      method: "POST",
      path: "/admin/reservations",
    })
    expect(byName("delete_reservation")).toMatchObject({
      method: "DELETE",
      path: "/admin/reservations/:id",
    })
    expect(byName("split_inventory_item")).toMatchObject({
      method: "POST",
      path: "/admin/inventory-items/:id/split",
    })
    // This repo's raw-material update is PUT; the create beside it is POST.
    expect(byName("update_inventory_raw_material")).toMatchObject({
      method: "PUT",
      path: "/admin/inventory-items/:id/rawmaterials/:rawMaterialId",
    })
  })

  it("sends only the fields the core validators accept (every one is .strict())", () => {
    expect(byName("set_inventory_level")!.bodyParams).toEqual([
      "location_id",
      "stocked_quantity",
      "incoming_quantity",
    ])
    // The single-level update takes the location from the PATH; sending
    // `location_id` in the body is rejected outright by the strict schema.
    expect(byName("update_inventory_level")!.bodyParams).toEqual([
      "stocked_quantity",
      "incoming_quantity",
    ])
    expect(byName("update_inventory_level")!.bodyParams).not.toContain("location_id")
    expect(byName("create_reservation")!.bodyParams).toEqual([
      "inventory_item_id",
      "location_id",
      "quantity",
      "line_item_id",
      "description",
      "metadata",
    ])
    expect(byName("split_inventory_item")!.bodyParams).toEqual([
      "quantity",
      "new_title",
      "location_id",
      "raw_material_overrides",
    ])
  })

  it("says that a stocked quantity is absolute, not a delta", () => {
    for (const name of ["set_inventory_level", "update_inventory_level"]) {
      expect(`${name}:${/ABSOLUTE|absolute/.test(byName(name)!.description)}`).toBe(
        `${name}:true`
      )
    }
    // The update is the destructive one: it overwrites a count that already
    // exists, so it also has to say what is lost.
    expect(byName("update_inventory_level")!.description).toMatch(/loses 30 units/)
    expect(byName("update_inventory_level")!.sideEffects).toBeTruthy()
  })

  it("warns that specifications and media REPLACE rather than merge", () => {
    const d = byName("update_inventory_raw_material")!
    expect(d.description).toMatch(/REPLACES/)
    expect(d.sideEffects).toMatch(/Replaces/)
  })

  it("teaches the media shape, and that an empty files array is not a photo", () => {
    for (const name of ["add_inventory_raw_material", "update_inventory_raw_material"]) {
      const d = byName(name)!.description
      expect(`${name}:${d.includes('"files"')}`).toBe(`${name}:true`)
    }
    // 12 of the first 50 raw materials in production carry `{files: []}` —
    // present, non-null, and showing nothing. The create tool is where that
    // gets prevented, so that is where the warning belongs.
    expect(byName("add_inventory_raw_material")!.description).toContain('"files": []')
  })

  it("points every id-demanding tool at one that produces the id", () => {
    // A stock location id is not guessable and nothing else surfaces it.
    for (const name of ["set_inventory_level", "create_inventory_item"]) {
      expect(`${name}:${byName(name)!.description.includes("list_stock_locations")}`).toBe(
        `${name}:true`
      )
    }
    expect(byName("get_raw_material")!.description).toMatch(/list_raw_materials/)
  })

  it("names the ordinary door to an inventory item, which is not create", () => {
    // A partner-supplied variant has no inventory item until an order line
    // names it; an item created directly is linked to nothing.
    const d = byName("create_inventory_item")!.description
    expect(d).toMatch(/inventory-order line|inventory_order line|order line/i)
    expect(d).toMatch(/create_inventory_order|update_inventory_order_lines/)
  })

  it("gates every mutation behind confirm, and none of them are dangerous", () => {
    const writes = NEW_TOOLS.map(byName).filter((d) => d!.method !== "GET")
    expect(writes.length).toBe(7)
    for (const d of writes) {
      expect(`${d!.name}:${d!.write === true}`).toBe(`${d!.name}:true`)
      expect(`${d!.name}:${d!.sensitive === true}`).toBe(`${d!.name}:true`)
      // Reversible platform edits: reachable by a write-scoped credential,
      // still confirm-gated in the admin UI.
      expect(`${d!.name}:${d!.tier}`).toBe(`${d!.name}:write`)
      expect(`${d!.name}:${d!.dangerous ?? false}`).toBe(`${d!.name}:false`)
    }
  })

  it("classifies every new tool into the inventory slice", () => {
    // An unclassified tool loads in NO slice — registered and unreachable.
    for (const name of NEW_TOOLS) {
      expect(`${name}:${toolDomain(byName(name)!)}`).toBe(`${name}:inventory`)
    }
  })
})

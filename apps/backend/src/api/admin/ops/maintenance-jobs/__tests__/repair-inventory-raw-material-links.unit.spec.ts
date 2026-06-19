import {
  diffInventoryRawMaterialLinks,
  getMaintenanceJob,
  MAINTENANCE_JOBS,
  MAX_RAW_MATERIAL_LINK_SCAN,
  repairInventoryRawMaterialLinksJob,
  summarizeRawMaterialLinkRepair,
} from "../registry"

/**
 * #508 — pure logic for the `repair-inventory-raw-material-links` maintenance
 * job. The container-bound run() (query.graph enumerate + module existence
 * checks + remoteLink.dismiss) is exercised by the API contract integration
 * test; here we lock down the orphan-detection decision and the summary string
 * without booting the DB.
 */
describe("repair-inventory-raw-material-links — diffInventoryRawMaterialLinks", () => {
  it("keeps a link whose inventory item AND raw material both exist", () => {
    const changes = diffInventoryRawMaterialLinks(
      [{ inventory_item_id: "iitem_1", raw_materials_id: "rm_1" }],
      new Set(["iitem_1"]),
      new Set(["rm_1"])
    )
    expect(changes).toEqual([])
  })

  it("removes an orphan whose inventory item was deleted", () => {
    const changes = diffInventoryRawMaterialLinks(
      [{ inventory_item_id: "iitem_gone", raw_materials_id: "rm_1" }],
      new Set(), // inventory item no longer exists
      new Set(["rm_1"])
    )
    expect(changes).toEqual([
      {
        entity: "inventory_item_raw_materials",
        id: "iitem_gone:rm_1",
        field: "remove_orphan_link",
        before: {
          inventory_item_id: "iitem_gone",
          raw_materials_id: "rm_1",
          missing: "inventory_item",
        },
        after: null,
      },
    ])
  })

  it("removes an orphan whose raw material was deleted", () => {
    const changes = diffInventoryRawMaterialLinks(
      [{ inventory_item_id: "iitem_1", raw_materials_id: "rm_gone" }],
      new Set(["iitem_1"]),
      new Set() // raw material no longer exists
    )
    expect(changes).toEqual([
      {
        entity: "inventory_item_raw_materials",
        id: "iitem_1:rm_gone",
        field: "remove_orphan_link",
        before: {
          inventory_item_id: "iitem_1",
          raw_materials_id: "rm_gone",
          missing: "raw_material",
        },
        after: null,
      },
    ])
  })

  it("tags 'both' when neither side exists", () => {
    const changes = diffInventoryRawMaterialLinks(
      [{ inventory_item_id: "iitem_gone", raw_materials_id: "rm_gone" }],
      new Set(),
      new Set()
    )
    expect(changes).toHaveLength(1)
    expect((changes[0].before as any).missing).toBe("both")
  })

  it("skips malformed rows missing either id (can't be dismissed)", () => {
    const changes = diffInventoryRawMaterialLinks(
      [
        { inventory_item_id: "iitem_1", raw_materials_id: null },
        { inventory_item_id: null, raw_materials_id: "rm_1" },
        { inventory_item_id: "", raw_materials_id: "" },
      ],
      new Set(),
      new Set()
    )
    expect(changes).toEqual([])
  })

  it("de-duplicates a repeated pivot pair (reports once)", () => {
    const changes = diffInventoryRawMaterialLinks(
      [
        { inventory_item_id: "iitem_gone", raw_materials_id: "rm_1" },
        { inventory_item_id: "iitem_gone", raw_materials_id: "rm_1" },
      ],
      new Set(),
      new Set(["rm_1"])
    )
    expect(changes).toHaveLength(1)
  })

  it("handles a mixed batch: keep the valid one, remove both orphans", () => {
    const changes = diffInventoryRawMaterialLinks(
      [
        { inventory_item_id: "iitem_keep", raw_materials_id: "rm_keep" }, // both live → keep
        { inventory_item_id: "iitem_gone", raw_materials_id: "rm_keep" }, // item gone → remove
        { inventory_item_id: "iitem_keep", raw_materials_id: "rm_gone" }, // rm gone → remove
      ],
      new Set(["iitem_keep"]),
      new Set(["rm_keep"])
    )
    expect(changes.map((c) => c.id)).toEqual([
      "iitem_gone:rm_keep",
      "iitem_keep:rm_gone",
    ])
  })
})

describe("repair-inventory-raw-material-links — summarizeRawMaterialLinkRepair", () => {
  it("reports no changes when nothing is orphaned", () => {
    expect(summarizeRawMaterialLinkRepair(true, 5, 0, 0)).toBe(
      "No changes — scanned 5 inventory↔raw-material link(s), none orphaned"
    )
  })

  it("uses 'Would' for a dry run", () => {
    expect(summarizeRawMaterialLinkRepair(true, 8, 2, 0)).toBe(
      "Would remove 2 orphan link(s) whose inventory item or raw material no longer exists (scanned 8)"
    )
  })

  it("uses 'Did' for an applied run and appends an error count", () => {
    expect(summarizeRawMaterialLinkRepair(false, 8, 1, 1)).toBe(
      "Did remove 1 orphan link(s) whose inventory item or raw material no longer exists (scanned 8); 1 error(s)"
    )
  })
})

describe("repair-inventory-raw-material-links — registry wiring", () => {
  it("is registered and discoverable by id", () => {
    expect(getMaintenanceJob("repair-inventory-raw-material-links")).toBe(
      repairInventoryRawMaterialLinksJob
    )
    expect(MAINTENANCE_JOBS).toContain(repairInventoryRawMaterialLinksJob)
  })

  it("declares an optional limit param and a sane cap", () => {
    expect(MAX_RAW_MATERIAL_LINK_SCAN).toBeGreaterThan(0)
    const names = repairInventoryRawMaterialLinksJob.params.map((p) => p.name)
    expect(names).toEqual(expect.arrayContaining(["limit"]))
    expect(
      repairInventoryRawMaterialLinksJob.params.every((p) => p.required === false)
    ).toBe(true)
  })
})

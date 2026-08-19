import {
  checkConsumptionAgainstAllocation,
  normalizeRunMaterials,
} from "../lib/run-materials"

/**
 * The per-assignment material allocation.
 *
 * Before this existed, a run snapshotted its design's ENTIRE bill of materials
 * and every partner was asked to account for all of it — a design with five
 * inventory items handed to two partners asked both about all five. These cases
 * pin the two rules that make an assignment a real selection, and, just as
 * importantly, the case where the rules must NOT fire.
 */
describe("normalizeRunMaterials", () => {
  const bom = ["iitem_silk", "iitem_thread", "iitem_lining"]

  it("keeps only what was chosen, out of everything the design can use", () => {
    const result = normalizeRunMaterials(
      [{ inventory_item_id: "iitem_silk", planned_quantity: 40 }],
      bom
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.materials).toHaveLength(1)
    expect(result.materials[0]).toMatchObject({
      inventory_item_id: "iitem_silk",
      planned_quantity: 40,
    })
  })

  it("carries the per-run colour choice, which the design-level link cannot hold", () => {
    // The design↔group link has ONE resolved_raw_material_id for the whole
    // design, so two runs of one design in two colours collide there.
    const a = normalizeRunMaterials(
      [{ inventory_item_id: "iitem_silk", resolved_raw_material_id: "rm_indigo" }],
      bom
    )
    const b = normalizeRunMaterials(
      [{ inventory_item_id: "iitem_silk", resolved_raw_material_id: "rm_madder" }],
      bom
    )
    expect(a.ok && a.materials[0].resolved_raw_material_id).toBe("rm_indigo")
    expect(b.ok && b.materials[0].resolved_raw_material_id).toBe("rm_madder")
  })

  it("refuses an item the design does not use", () => {
    // Quietly dropping it would ship the partner a short BOM and say nothing.
    const result = normalizeRunMaterials(
      [{ inventory_item_id: "iitem_from_another_design" }],
      bom
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("iitem_from_another_design")
    expect(result.error).toContain("bill of materials")
  })

  it("refuses the same item twice — two answers to 'how much'", () => {
    const result = normalizeRunMaterials(
      [
        { inventory_item_id: "iitem_silk", planned_quantity: 40 },
        { inventory_item_id: "iitem_silk", planned_quantity: 12 },
      ],
      bom
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("twice")
  })

  it.each([0, -3])("refuses planned_quantity %p", (qty) => {
    // "Allocate 0 of the silk" passes the consumption gate while promising
    // nothing — an omission written down as if it were a decision.
    const result = normalizeRunMaterials(
      [{ inventory_item_id: "iitem_silk", planned_quantity: qty }],
      bom
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain("positive")
  })

  it("leaves planned_quantity null when it was not stated", () => {
    const result = normalizeRunMaterials([{ inventory_item_id: "iitem_silk" }], bom)
    expect(result.ok && result.materials[0].planned_quantity).toBeNull()
  })

  it("skips the subset rule when the run has no design (#1112 product-only path)", () => {
    // There is nothing to be a subset OF; failing everything would be wrong.
    const result = normalizeRunMaterials(
      [{ inventory_item_id: "iitem_anything" }],
      null
    )
    expect(result.ok).toBe(true)
  })

  it.each([undefined, null, []])("treats %p as no allocation, not an error", (m) => {
    const result = normalizeRunMaterials(m as any, bom)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.materials).toEqual([])
  })
})

describe("checkConsumptionAgainstAllocation", () => {
  it("refuses an item outside the allocation, and says what IS assigned", () => {
    const verdict = checkConsumptionAgainstAllocation({
      allocatedInventoryItemIds: ["iitem_silk", "iitem_thread"],
      inventoryItemId: "iitem_lining",
      labelsById: {
        iitem_silk: "Mulberry silk",
        iitem_thread: "Cotton thread",
        iitem_lining: "Lining",
      },
    })
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    // A partner cannot act on `iitem_lining is not allowed`.
    expect(verdict.reason).toContain("Lining")
    expect(verdict.reason).toContain("Mulberry silk")
    expect(verdict.reason).toContain("Cotton thread")
  })

  it("allows an item inside the allocation", () => {
    const verdict = checkConsumptionAgainstAllocation({
      allocatedInventoryItemIds: ["iitem_silk"],
      inventoryItemId: "iitem_silk",
    })
    expect(verdict).toEqual({ allowed: true, constrained: true })
  })

  /**
   * THE CONTROL THAT MUST NOT FIRE.
   *
   * Every run made before this feature has no allocation, as does any
   * assignment sent without `materials`. Reading that emptiness as "chose
   * nothing" rather than "nobody chose" would 400 the entire existing floor —
   * the failure would look exactly like the feature working.
   */
  it.each([undefined, null, []])(
    "leaves a run with %p allocation unconstrained",
    (allocation) => {
      const verdict = checkConsumptionAgainstAllocation({
        allocatedInventoryItemIds: allocation as any,
        inventoryItemId: "iitem_anything_at_all",
      })
      expect(verdict).toEqual({ allowed: true, constrained: false })
    }
  )

  it("requires an inventory item once an allocation exists", () => {
    const verdict = checkConsumptionAgainstAllocation({
      allocatedInventoryItemIds: ["iitem_silk"],
      inventoryItemId: undefined,
    })
    expect(verdict.allowed).toBe(false)
  })
})

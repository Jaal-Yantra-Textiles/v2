import {
  checkAllocationEdit,
  checkConsumptionAgainstAllocation,
  normalizeRunMaterials,
  type NormalizedRunMaterial,
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

/**
 * checkAllocationEdit (#2111) — the freeze, made add-only.
 *
 * The flat freeze protected the partner from having work retracted under them,
 * which is right. But it also meant material bought AFTER a run started could
 * never be attached to it: we bought 2 Mill Spun Pashminas for a tunic whose
 * run had been under way for a week, and that run was the one run that could
 * never record them. The consignment gate keys on exactly that attachment, so
 * the cloth could never come off our books either.
 *
 * Adding is allowed. Removing, shrinking and relocating are not — each of those
 * takes back something the partner was already promised.
 */
describe("checkAllocationEdit", () => {
  const mat = (
    over: Partial<NormalizedRunMaterial> & { inventory_item_id: string }
  ): NormalizedRunMaterial => ({
    planned_quantity: null,
    location_id: null,
    resolved_raw_material_id: null,
    note: null,
    metadata: null,
    ...over,
  })

  const SILK = mat({
    inventory_item_id: "iitem_silk",
    planned_quantity: 5,
    location_id: "sloc_kiyo",
  })
  const PASHMINA = mat({
    inventory_item_id: "iitem_pashmina",
    planned_quantity: 2,
    location_id: "sloc_kiyo",
  })

  const check = (existing: NormalizedRunMaterial[], next: NormalizedRunMaterial[]) =>
    checkAllocationEdit(existing, next, { accepted: true })

  it("allows anything at all before the partner has accepted", () => {
    expect(
      checkAllocationEdit([SILK], [], { accepted: false })
    ).toEqual({ allowed: true })
  })

  it("🔴 allows ADDING the pashmina to a run already under way — the case this exists for", () => {
    expect(check([SILK], [SILK, PASHMINA])).toEqual({ allowed: true })
  })

  it("allows allocating to a started run that had nothing allocated", () => {
    expect(check([], [PASHMINA])).toEqual({ allowed: true })
  })

  it("allows RAISING a quantity — issuing more of what they already have", () => {
    expect(check([SILK], [{ ...SILK, planned_quantity: 8 }])).toEqual({
      allowed: true,
    })
  })

  it("allows recording a quantity that was never agreed", () => {
    const unstated = mat({ inventory_item_id: "iitem_silk", location_id: "sloc_kiyo" })
    expect(check([unstated], [{ ...unstated, planned_quantity: 3 }])).toEqual({
      allowed: true,
    })
  })

  it("🔴 refuses REMOVING an item", () => {
    const v = check([SILK, PASHMINA], [SILK])
    expect(v.allowed).toBe(false)
    expect(!v.allowed && v.reason).toContain("not remove it")
  })

  it("🔴 refuses clearing the allocation wholesale", () => {
    const v = check([SILK], [])
    expect(v.allowed).toBe(false)
    expect(!v.allowed && v.reason).toContain("not remove it")
  })

  it("🔴 refuses LOWERING a quantity", () => {
    const v = check([SILK], [{ ...SILK, planned_quantity: 3 }])
    expect(v.allowed).toBe(false)
    expect(!v.allowed && v.reason).toContain("reduce")
  })

  it("🔴 refuses retracting an agreed quantity back to unstated", () => {
    const v = check([SILK], [{ ...SILK, planned_quantity: null }])
    expect(v.allowed).toBe(false)
    expect(!v.allowed && v.reason).toContain("reduce")
  })

  it("🔴 refuses MOVING where the material is drawn from", () => {
    const v = check([SILK], [{ ...SILK, location_id: "sloc_dharamshala" }])
    expect(v.allowed).toBe(false)
    expect(!v.allowed && v.reason).toContain("Cannot move")
  })

  it("allows setting a location where none was recorded", () => {
    const noLoc = mat({ inventory_item_id: "iitem_silk", planned_quantity: 5 })
    expect(check([noLoc], [{ ...noLoc, location_id: "sloc_kiyo" }])).toEqual({
      allowed: true,
    })
  })

  it("names the material a human recognises rather than an id", () => {
    const v = checkAllocationEdit([SILK], [], {
      accepted: true,
      label: (id) => (id === "iitem_silk" ? "Mulberry Silk" : id),
    })
    expect(!v.allowed && v.reason).toContain("Mulberry Silk")
  })
})

import { planNegativeLevelResets } from "../reset-negative-inventory-levels-job"

/**
 * A negative level is never a real position — you cannot hold minus two and a
 * half metres of cloth. These pin what qualifies, and just as importantly what
 * does not: zero is already correct, and a large negative is evidence worth
 * keeping rather than erasing.
 */
describe("planNegativeLevelResets", () => {
  const level = (
    id: string,
    stocked: number | string | null,
    item = "iitem_a",
    loc = "sloc_a"
  ) => ({
    id,
    inventory_item_id: item,
    location_id: loc,
    stocked_quantity: stocked,
  })

  it("resets a negative level to zero", () => {
    // The live case: FAB-TWO-BLU-001 at Shramdaan.
    expect(planNegativeLevelResets([level("ilev_1", -2.5)])).toEqual([
      expect.objectContaining({
        level_id: "ilev_1",
        inventory_item_id: "iitem_a",
        location_id: "sloc_a",
        before: -2.5,
        after: 0,
      }),
    ])
  })

  it("leaves zero alone rather than writing a no-op", () => {
    expect(planNegativeLevelResets([level("ilev_1", 0)])).toEqual([])
  })

  it("leaves positive levels alone", () => {
    expect(planNegativeLevelResets([level("ilev_1", 17.6)])).toEqual([])
  })

  it("carries the item and location, since the workflow ignores the level id", () => {
    // #1251: updateInventoryLevels_ re-resolves from the pair, so dropping
    // these gives "Item undefined is not stocked at location undefined".
    const [r] = planNegativeLevelResets([
      level("ilev_1", -1, "iitem_muslin", "sloc_dharamshala"),
    ])

    expect(r.inventory_item_id).toBe("iitem_muslin")
    expect(r.location_id).toBe("sloc_dharamshala")
  })

  it("refuses a negative larger than max_magnitude, keeping the evidence", () => {
    expect(
      planNegativeLevelResets([level("ilev_1", -400)], { maxMagnitude: 10 })
    ).toEqual([])
  })

  it("still resets a small negative inside the guard", () => {
    expect(
      planNegativeLevelResets([level("ilev_1", -2.5)], { maxMagnitude: 10 })
    ).toHaveLength(1)
  })

  it("handles string quantities", () => {
    expect(planNegativeLevelResets([level("ilev_1", "-2.5")])).toHaveLength(1)
  })

  it("ignores a non-numeric quantity rather than writing NaN", () => {
    expect(planNegativeLevelResets([level("ilev_1", "not-a-number")])).toEqual([])
  })

  it("picks only the negatives out of a mixed set", () => {
    const resets = planNegativeLevelResets([
      level("ilev_1", 17.6, "iitem_a"),
      level("ilev_2", -2.5, "iitem_b"),
      level("ilev_3", 0, "iitem_c"),
      level("ilev_4", -0.5, "iitem_d"),
    ])

    expect(resets.map((r) => r.level_id)).toEqual(["ilev_2", "ilev_4"])
  })
})

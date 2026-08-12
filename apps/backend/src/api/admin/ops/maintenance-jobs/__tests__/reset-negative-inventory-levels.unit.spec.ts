import {
  countComparableLevels,
  findLevelValueDivergence,
  planNegativeLevelResets,
} from "../reset-negative-inventory-levels-job"

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

  it("catches a negative hiding in the raw column while numeric reads 0", () => {
    // The live miss: FAB-TWO-BLU-001 read 0 through one route and -2.5 through
    // the item relation, and the first version of this job reported it clean.
    const resets = planNegativeLevelResets([
      {
        ...level("ilev_1", 0),
        raw_stocked_quantity: { value: "-2.5", precision: 20 },
      },
    ])

    expect(resets).toHaveLength(1)
    expect(resets[0].before).toBe(-2.5)
  })

  it("takes the worse of the two sides", () => {
    const [r] = planNegativeLevelResets([
      {
        ...level("ilev_1", -1),
        raw_stocked_quantity: { value: "-9", precision: 20 },
      },
    ])

    expect(r.before).toBe(-9)
  })

  it("leaves a level alone when both sides are sound", () => {
    expect(
      planNegativeLevelResets([
        {
          ...level("ilev_1", 19),
          raw_stocked_quantity: { value: "19", precision: 20 },
        },
      ])
    ).toEqual([])
  })

  it("applies max_magnitude to the worse side", () => {
    expect(
      planNegativeLevelResets(
        [
          {
            ...level("ilev_1", 0),
            raw_stocked_quantity: { value: "-400", precision: 20 },
          },
        ],
        { maxMagnitude: 10 }
      )
    ).toEqual([])
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

/**
 * A `bigNumber` lives in two columns and they can drift apart. That is worse
 * than a wrong number, because it defeats the check that would catch a wrong
 * number — whichever side a tool reads, it is confident and may be wrong.
 */
describe("findLevelValueDivergence", () => {
  const lvl = (numeric: number | string | null, raw: unknown) => ({
    id: "ilev_1",
    inventory_item_id: "iitem_a",
    location_id: "sloc_a",
    stocked_quantity: numeric,
    raw_stocked_quantity: raw,
  })

  it("reports the live case: numeric 0, raw -2.5", () => {
    expect(
      findLevelValueDivergence([lvl(0, { value: "-2.5", precision: 20 })])
    ).toEqual([expect.objectContaining({ numeric: 0, raw: -2.5 })])
  })

  it("says nothing when the two agree", () => {
    expect(
      findLevelValueDivergence([lvl(19, { value: "19", precision: 20 })])
    ).toEqual([])
  })

  it("treats a missing raw column as no evidence, not as disagreement", () => {
    // Several read paths simply do not return raw_. Absence must not be noise.
    expect(findLevelValueDivergence([lvl(19, null)])).toEqual([])
  })

  it("reads a bare raw value as well as the {value} wrapper", () => {
    expect(findLevelValueDivergence([lvl(0, "-2.5")])).toHaveLength(1)
  })

  it("never picks a winner — it only reports both", () => {
    const [d] = findLevelValueDivergence([lvl(5, { value: "7", precision: 20 })])

    expect(d.numeric).toBe(5)
    expect(d.raw).toBe(7)
    expect(d).not.toHaveProperty("after")
  })

  it("ignores an unparseable raw rather than reporting a false divergence", () => {
    expect(findLevelValueDivergence([lvl(19, { value: "abc" })])).toEqual([])
  })
})

/**
 * The denominator (#1259). `findLevelValueDivergence` skips rows with no
 * readable raw_ column, so a detector that never receives that column reports
 * clean forever — a dead check and a working one print identical output. These
 * pin that the count mirrors the skip conditions exactly, because a count that
 * disagrees with the check it describes is worse than no count at all.
 */
describe("countComparableLevels", () => {
  const lvl = (numeric: number | string | null, raw: unknown) => ({
    stocked_quantity: numeric,
    raw_stocked_quantity: raw,
  })

  it("counts a row where both stored values are readable", () => {
    expect(countComparableLevels([lvl(19, { value: "19", precision: 20 })])).toEqual({
      compared: 1,
      total: 1,
    })
  })

  it("reports 0/N when no row carries a raw column — the inert-detector case", () => {
    // This is the reading the job must never present as reassurance: the check
    // looked at nothing and said nothing.
    expect(countComparableLevels([lvl(19, null), lvl(0, undefined)])).toEqual({
      compared: 0,
      total: 2,
    })
  })

  it("counts the diverging row too — comparable is not the same as agreeing", () => {
    expect(
      countComparableLevels([lvl(0, { value: "-2.5", precision: 20 })])
    ).toEqual({ compared: 1, total: 1 })
  })

  it("does not count an unparseable raw, matching what the check skips", () => {
    expect(countComparableLevels([lvl(19, { value: "abc" })])).toEqual({
      compared: 0,
      total: 1,
    })
  })

  it("does not count a non-numeric stocked_quantity, matching what the check skips", () => {
    expect(countComparableLevels([lvl("not-a-number", "19")])).toEqual({
      compared: 0,
      total: 1,
    })
  })

  it("counts a partial denominator across a mixed set", () => {
    expect(
      countComparableLevels([
        lvl(19, { value: "19", precision: 20 }),
        lvl(0, null),
        lvl(3, "3"),
      ])
    ).toEqual({ compared: 2, total: 3 })
  })

  it("never claims coverage it does not have on an empty read", () => {
    expect(countComparableLevels([])).toEqual({ compared: 0, total: 0 })
  })
})

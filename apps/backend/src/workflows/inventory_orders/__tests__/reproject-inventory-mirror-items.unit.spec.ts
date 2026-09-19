import {
  planMirrorReprojection,
  type LiveInventoryLine,
  type MirrorItem,
} from "../reproject-inventory-mirror-items"

const line = (
  id: string,
  title: string,
  quantity: number,
  price: number,
  extra_cost = 0
): LiveInventoryLine => ({
  id,
  title,
  quantity,
  price,
  extra_cost,
  inventory_item_id: `iitem_${id}`,
})

const item = (id: string, title: string, quantity: number, unit_price: number, legacy: string | null): MirrorItem => ({
  id,
  title,
  quantity,
  unit_price,
  legacy_orderline_id: legacy,
})

describe("planMirrorReprojection", () => {
  it("no drift: matching lines produce no creates and no removes", () => {
    const lines = [line("l1", "Cotton", 10, 100), line("l2", "Silk", 5, 200)]
    const items = [
      item("it1", "Cotton", 10, 100, "l1"),
      item("it2", "Silk", 5, 200, "l2"),
    ]
    const plan = planMirrorReprojection(lines, items)
    expect(plan.create).toHaveLength(0)
    expect(plan.removeItemIds).toHaveLength(0)
    expect(plan.unchanged).toBe(2)
  })

  it("the prod incident: stale originals removed, new lines created", () => {
    // mirror still holds the 2 original items keyed to now-deleted lines; the
    // inventory order now has 3 different live lines.
    const items = [
      item("ordli_A", "Dress Suit Material", 15, 103.33, "old_line_A"),
      item("ordli_B", "Shirt", 12, 50, "old_line_B"),
    ]
    const lines = [
      line("new_1", "Tangaliya Weave — Black", 1, 1400),
      line("new_2", "Tangaliya Weave — Blue", 1, 1400),
      line("new_3", "Tangaliya Weave", 12, 600),
    ]
    const plan = planMirrorReprojection(lines, items)
    expect(plan.removeItemIds.sort()).toEqual(["ordli_A", "ordli_B"])
    expect(plan.create).toHaveLength(3)
    expect(plan.unchanged).toBe(0)
    // created items carry the legacy key + inventory linkage for future diffs
    expect(plan.create[0].metadata).toMatchObject({
      legacy_orderline_id: "new_1",
      inventory_item_id: "iitem_new_1",
    })
  })

  it("changed qty/price/title: remove old item + create fresh (never in-place)", () => {
    const items = [item("it1", "Cotton", 10, 100, "l1")]
    const lines = [line("l1", "Cotton", 20, 100)] // qty 10 -> 20
    const plan = planMirrorReprojection(lines, items)
    expect(plan.removeItemIds).toEqual(["it1"])
    expect(plan.create).toHaveLength(1)
    expect(plan.create[0].quantity).toBe(20)
    expect(plan.unchanged).toBe(0)
  })

  it("mixed add + keep + remove in one pass", () => {
    const items = [
      item("keep", "Cotton", 10, 100, "l1"), // unchanged
      item("stale", "Old", 1, 1, "l_gone"), // legacy no longer live
    ]
    const lines = [
      line("l1", "Cotton", 10, 100), // matches keep
      line("l2", "Silk", 5, 200), // new
    ]
    const plan = planMirrorReprojection(lines, items)
    expect(plan.unchanged).toBe(1)
    expect(plan.removeItemIds).toEqual(["stale"])
    expect(plan.create.map((c) => c.metadata.legacy_orderline_id)).toEqual(["l2"])
  })

  it("keyless mirror items (no legacy_orderline_id) are always removed", () => {
    const items = [item("legacyless", "Mystery", 1, 1, null)]
    const lines = [line("l1", "Cotton", 10, 100)]
    const plan = planMirrorReprojection(lines, items)
    expect(plan.removeItemIds).toEqual(["legacyless"])
    expect(plan.create).toHaveLength(1)
  })

  // #2172 — the create path folds `extra_cost` into the mirrored unit price and
  // the re-projection did not, so the first edit of a dyed order stripped the
  // whole colour job out of the mirror (₹8,208 on the GOF order).
  describe("extra_cost (the colour job) rides on the mirrored unit price", () => {
    it("a new line is mirrored at price + extra_cost, not price", () => {
      const lines = [line("l1", "Mulberry Silk 3/4", 12.9, 690, 120)]
      const plan = planMirrorReprojection(lines, [])
      expect(plan.create).toHaveLength(1)
      expect(plan.create[0].unit_price).toBe(810)
      expect(plan.create[0].metadata.legacy_unit_price).toBe(810)
    })

    it("a mirror item already at the landed rate is left alone", () => {
      const lines = [line("l1", "Mulberry Silk 3/4", 12.9, 690, 120)]
      const items = [item("it1", "Mulberry Silk 3/4", 12.9, 810, "l1")]
      const plan = planMirrorReprojection(lines, items)
      expect(plan.unchanged).toBe(1)
      expect(plan.create).toHaveLength(0)
      expect(plan.removeItemIds).toHaveLength(0)
    })

    it("a mirror item stuck at the BASE rate is recreated at the landed one", () => {
      // the state the GOF order was actually found in: a prior edit wrote 690.
      const lines = [line("l1", "Mulberry Silk 3/4", 12.9, 690, 120)]
      const items = [item("it1", "Mulberry Silk 3/4", 12.9, 690, "l1")]
      const plan = planMirrorReprojection(lines, items)
      expect(plan.removeItemIds).toEqual(["it1"])
      expect(plan.create[0].unit_price).toBe(810)
    })

    it("the whole GOF shortfall: 68.4 dyed metres x 120 = 8208", () => {
      const lines = [
        line("a", "40 lea Linen", 30, 165, 120),
        line("b", "60lea Linen", 11.4, 255, 120),
        line("c", "Mulberry Silk 3/4", 12.9, 690, 120),
        line("d", "Tussar", 8.1, 1155, 120),
        line("e", "Muslin 150s", 6, 1460, 120),
      ]
      const total = (plan: ReturnType<typeof planMirrorReprojection>) =>
        plan.create.reduce((sum, c) => sum + c.unit_price * c.quantity, 0)
      const withJob = total(planMirrorReprojection(lines, []))
      const withoutJob = total(
        planMirrorReprojection(
          lines.map((l) => ({ ...l, extra_cost: 0 })),
          []
        )
      )
      expect(Math.round((withJob - withoutJob) * 100) / 100).toBe(8208)
    })

    it("a line with no colour job is unaffected (extra_cost absent, not 0)", () => {
      const lines: LiveInventoryLine[] = [
        { id: "l1", title: "Cotton", quantity: 10, price: 100, inventory_item_id: null },
      ]
      const plan = planMirrorReprojection(lines, [])
      expect(plan.create[0].unit_price).toBe(100)
    })
  })

  it("all lines removed: every mirror item is dropped, nothing created", () => {
    const items = [item("it1", "Cotton", 10, 100, "l1")]
    const plan = planMirrorReprojection([], items)
    expect(plan.removeItemIds).toEqual(["it1"])
    expect(plan.create).toHaveLength(0)
  })
})

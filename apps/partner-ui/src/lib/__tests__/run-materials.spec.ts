import { describe, expect, it } from "vitest"

import { resolveRunMaterialOptions } from "../run-materials"

const design = {
  inventory_items: [
    { id: "iitem_silk", title: "Mulberry silk" },
    { id: "iitem_thread", title: "Cotton thread" },
    { id: "iitem_lining", title: "Lining" },
  ],
}

describe("resolveRunMaterialOptions", () => {
  it("offers ONLY what the run was assigned, not the whole design", () => {
    const { options, constrained } = resolveRunMaterialOptions(
      {
        materials: [
          {
            inventory_item_id: "iitem_silk",
            planned_quantity: "40",
            inventory_item: { id: "iitem_silk", title: "Mulberry silk" },
          },
        ],
      },
      design
    )
    expect(constrained).toBe(true)
    expect(options.map((o) => o.id)).toEqual(["iitem_silk"])
    // Offering the other two would offer a choice the save then rejects.
    expect(options[0].planned_quantity).toBe(40)
  })

  /** The control: an unallocated run must not lose its materials list. */
  it.each([undefined, null, []])(
    "falls back to the design BOM when materials is %p",
    (materials) => {
      const { options, constrained } = resolveRunMaterialOptions(
        { materials },
        design
      )
      expect(constrained).toBe(false)
      expect(options.map((o) => o.id)).toEqual([
        "iitem_silk",
        "iitem_thread",
        "iitem_lining",
      ])
    }
  )

  it("survives a design with no BOM at all", () => {
    expect(resolveRunMaterialOptions({}, {}).options).toEqual([])
  })
})

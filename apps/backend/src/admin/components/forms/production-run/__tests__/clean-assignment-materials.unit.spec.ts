import { cleanAssignmentMaterialsForSave } from "../clean-assignment-materials"

const label = (id: string) =>
  ({ iitem_silk: "Mulberry silk" } as Record<string, string>)[id] || id

describe("cleanAssignmentMaterialsForSave", () => {
  it("sends only the selected items", () => {
    const result = cleanAssignmentMaterialsForSave([
      { inventory_item_id: "iitem_silk", selected: true, planned_quantity: "40" },
      { inventory_item_id: "iitem_lining", selected: false, planned_quantity: "" },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.materials).toEqual([
      { inventory_item_id: "iitem_silk", planned_quantity: 40 },
    ])
  })

  /**
   * #1361's exact shape: an unselected row must never become a payload the API
   * rejects. The form must not build something the form cannot save.
   */
  it.each([
    [{ inventory_item_id: "", selected: true }],
    [{ inventory_item_id: "iitem_silk", selected: false }],
    [{ inventory_item_id: "iitem_silk" }],
  ])("drops the untouched row %p as noise", (draft) => {
    const result = cleanAssignmentMaterialsForSave([draft as any])
    expect(result.ok && result.materials).toEqual([])
  })

  it("allows a selected item with no quantity — 'amount unstated' is a real answer", () => {
    const result = cleanAssignmentMaterialsForSave([
      { inventory_item_id: "iitem_silk", selected: true, planned_quantity: "" },
    ])
    expect(result.ok && result.materials).toEqual([
      { inventory_item_id: "iitem_silk" },
    ])
  })

  it.each(["0", "-2", "abc"])(
    "refuses a selected item whose quantity was typed as %p, in words",
    (qty) => {
      const result = cleanAssignmentMaterialsForSave(
        [{ inventory_item_id: "iitem_silk", selected: true, planned_quantity: qty }],
        label
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      // Not a zod path. The backend would say
      // "planned_quantity for iitem_silk must be a positive number".
      expect(result.error).toContain("Mulberry silk")
      expect(result.error).toContain("greater than 0")
    }
  )

  it.each([undefined, null, []])("treats %p as no materials", (drafts) => {
    const result = cleanAssignmentMaterialsForSave(drafts as any)
    expect(result.ok && result.materials).toEqual([])
  })
})

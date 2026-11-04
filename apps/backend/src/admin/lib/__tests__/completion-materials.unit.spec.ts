import {
  completionConsumptionsPayload,
  completionMaterialRows,
} from "../completion-materials"

describe("completionMaterialRows", () => {
  // Shaped like Prince's denim run on prod: no allocation, BOM on the snapshot.
  const run = {
    snapshot: {
      inventory_links: [
        {
          inventory_item_id: "iitem_denim",
          planned_quantity: "6.450000",
          inventory_item: {
            title: "HandloomDenim",
            raw_materials: { unit_cost: 600, unit_of_measure: "Meter" },
          },
        },
      ],
    },
  }

  it("prefills from the design BOM on the snapshot when the run has no allocation", () => {
    expect(completionMaterialRows(run, [])).toEqual([
      {
        inventory_item_id: "iitem_denim",
        title: "HandloomDenim",
        quantity: "6.45",
        unit_cost: "600",
        unit_of_measure: "Meter",
      },
    ])
  })

  it("prefers the run's allocation, keeping the BOM's cost for the same item", () => {
    const rows = completionMaterialRows(run, [
      {
        inventory_item_id: "iitem_denim",
        planned_quantity: 4,
        inventory_item: { title: "Denim (allocated)" },
      },
    ])
    expect(rows).toEqual([
      expect.objectContaining({ title: "Denim (allocated)", quantity: "4", unit_cost: "600" }),
    ])
  })

  it("leaves quantity and cost blank rather than inventing them", () => {
    const [row] = completionMaterialRows(
      { snapshot: { inventory_links: [{ inventory_item_id: "iitem_x", inventory_item: {} }] } },
      null
    )
    expect(row).toMatchObject({ quantity: "", unit_cost: "", unit_of_measure: "Meter" })
  })
})

describe("completionConsumptionsPayload", () => {
  it("sends only lines with a quantity, always as the run's total", () => {
    expect(
      completionConsumptionsPayload([
        { inventory_item_id: "a", title: "A", quantity: "6.45", unit_cost: "600", unit_of_measure: "Meter" },
        { inventory_item_id: "b", title: "B", quantity: "", unit_cost: "50", unit_of_measure: "Meter" },
        { inventory_item_id: "c", title: "C", quantity: "2", unit_cost: "", unit_of_measure: "Piece" },
      ])
    ).toEqual([
      { inventory_item_id: "a", quantity: 6.45, quantity_basis: "total", unit_cost: 600, unit_of_measure: "Meter" },
      { inventory_item_id: "c", quantity: 2, quantity_basis: "total", unit_cost: undefined, unit_of_measure: "Piece" },
    ])
  })
})

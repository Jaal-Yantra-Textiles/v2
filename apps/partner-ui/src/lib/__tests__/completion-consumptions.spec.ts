import { describe, expect, it } from "vitest"

import { buildConsumptionsPayload } from "../completion-consumptions"

describe("buildConsumptionsPayload (prod 2026-10-13)", () => {
  const row = {
    inventory_item_id: "iitem_1",
    quantity: "2.5",
    unit_cost: "180",
    unit_of_measure: "Meter",
    notes: "",
  }

  it("says every quantity is what this run used in total", () => {
    expect(buildConsumptionsPayload([row])).toEqual([
      {
        inventory_item_id: "iitem_1",
        quantity: 2.5,
        quantity_basis: "total",
        unit_cost: 180,
        unit_of_measure: "Meter",
        notes: undefined,
      },
    ])
  })

  it("drops rows with no quantity", () => {
    expect(buildConsumptionsPayload([{ ...row, quantity: "" }, { ...row, quantity: "0" }])).toEqual([])
  })
})

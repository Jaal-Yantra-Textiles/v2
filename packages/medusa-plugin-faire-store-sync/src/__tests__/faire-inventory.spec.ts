import { inventoryLevelsToPush } from "../lib/faire-inventory"

const variants = [
  { sku: "BUTTERFLY-LACE-M", available_quantity: 3 },
  { sku: "CUSTOM-01M40K3Y9ZMZ45BQ4WFTMWE3ZV-L", available_quantity: 0 },
]

describe("inventoryLevelsToPush", () => {
  // Butterfly Shirt, 2026-11-18: the push right after create 404'd on the first
  // SKU; the create payload had already stocked every variant.
  it("pushes nothing after a create", () => {
    expect(inventoryLevelsToPush(variants, true)).toEqual([])
  })

  it("pushes every real SKU on an update, zeros included", () => {
    expect(inventoryLevelsToPush(variants, false)).toEqual([
      { sku: "BUTTERFLY-LACE-M", on_hand_quantity: 3 },
      { sku: "CUSTOM-01M40K3Y9ZMZ45BQ4WFTMWE3ZV-L", on_hand_quantity: 0 },
    ])
  })

  it("skips variants sent under a Medusa id instead of a SKU", () => {
    expect(
      inventoryLevelsToPush(
        [
          { sku: "variant_01ABC", available_quantity: 2 },
          { sku: "prod_01ABC", available_quantity: 2 },
          { sku: "REAL-SKU" },
        ],
        false
      )
    ).toEqual([{ sku: "REAL-SKU", on_hand_quantity: 0 }])
  })
})

import { planAwaitingMaterials } from "../awaiting-materials"

const designs = [
  { id: "d_denim", title: "Baggy Trouser, Handloom Denim (28)" },
  { id: "d_silk", title: "Baggy Trouser, Kethiya Silk (28)" },
]

describe("planAwaitingMaterials", () => {
  it("lists a piece whose run waits on cloth that has not been delivered", () => {
    const lines = planAwaitingMaterials({
      designs,
      runs: [
        { design_id: "d_denim", status: "approved", partner_name: "Prince Tailors", depends_on_inventory_order_ids: ["io_1"] },
      ],
      orders: [{ id: "io_1", status: "Pending", supplier_name: "Shramdaan" }],
    })
    expect(lines).toEqual([
      { design: "Baggy Trouser, Handloom Denim (28)", suppliers: ["Shramdaan"], maker: "Prince Tailors" },
    ])
  })

  it("a Shipped order still counts as waiting; only Delivered releases", () => {
    const shipped = planAwaitingMaterials({
      designs,
      runs: [{ design_id: "d_silk", status: "approved", partner_name: "Prince Tailors", depends_on_inventory_order_ids: ["io_2"] }],
      orders: [{ id: "io_2", status: "Shipped", supplier_name: "Bhagalpur Handloom SHG" }],
    })
    expect(shipped).toHaveLength(1)

    const delivered = planAwaitingMaterials({
      designs,
      runs: [{ design_id: "d_silk", status: "approved", partner_name: "Prince Tailors", depends_on_inventory_order_ids: ["io_2"] }],
      orders: [{ id: "io_2", status: "Delivered", supplier_name: "Bhagalpur Handloom SHG" }],
    })
    expect(delivered).toEqual([])
  })

  it("an order with no run waiting on goods is not 'like this'", () => {
    expect(
      planAwaitingMaterials({
        designs,
        runs: [
          { design_id: "d_denim", status: "approved", partner_name: "Prince Tailors", depends_on_inventory_order_ids: null },
          { design_id: "d_silk", status: "in_progress", partner_name: "Prince Tailors", depends_on_inventory_order_ids: ["io_3"] },
        ],
        orders: [{ id: "io_3", status: "Pending", supplier_name: "Shramdaan" }],
      })
    ).toEqual([])
  })

  it("names each supplier once, in order", () => {
    const [line] = planAwaitingMaterials({
      designs: [designs[0]],
      runs: [
        { design_id: "d_denim", status: "approved", partner_name: "Prince Tailors", depends_on_inventory_order_ids: ["io_a", "io_b", "io_c"] },
      ],
      orders: [
        { id: "io_a", status: "Pending", supplier_name: "Shramdaan" },
        { id: "io_b", status: "Processing", supplier_name: "Bhagalpur Handloom SHG" },
        { id: "io_c", status: "Pending", supplier_name: "Shramdaan" },
      ],
    })
    expect(line.suppliers).toEqual(["Shramdaan", "Bhagalpur Handloom SHG"])
  })
})

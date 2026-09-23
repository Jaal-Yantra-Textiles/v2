import { ordersStrandedByMove } from "../split-partner-shipping-profile-job"

/**
 * #1983 — the open-order guard. Medusa re-checks the product's profile against
 * the order's shipping option at FULFILLMENT, so a move that leaves an open
 * order's product and option on different profiles makes it unfulfillable.
 */
describe("ordersStrandedByMove", () => {
  const optionTarget = new Map([
    ["so_partner", "partner" as const],
    ["so_house", "house" as const],
  ])
  const order = (id: string, product: string, option: string) => ({
    id,
    display_id: Number(id),
    items: [{ product_id: product }],
    shipping_methods: [{ shipping_option_id: option }],
  })

  it("names an open order whose option ends up on the other side", () => {
    expect(
      ordersStrandedByMove({
        productId: "prod_1",
        productTarget: "partner",
        openOrders: [order("7", "prod_1", "so_house")],
        optionTarget,
      })
    ).toEqual(["#7"])
  })

  it("lets a product move when its open order's option moves with it", () => {
    expect(
      ordersStrandedByMove({
        productId: "prod_1",
        productTarget: "partner",
        openOrders: [order("7", "prod_1", "so_partner")],
        optionTarget,
      })
    ).toEqual([])
  })

  it("ignores open orders that do not contain the product", () => {
    expect(
      ordersStrandedByMove({
        productId: "prod_1",
        productTarget: "partner",
        openOrders: [order("8", "prod_other", "so_house")],
        optionTarget,
      })
    ).toEqual([])
  })
})

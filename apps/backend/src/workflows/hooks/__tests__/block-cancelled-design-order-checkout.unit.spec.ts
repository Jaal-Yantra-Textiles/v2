/**
 * A cancelled design order's cart must not complete through the store API:
 * the cancel only hid the link, and a buyer with the cart id could still pay.
 */
let validateHandler: (input: { cart: any }) => Promise<void>

jest.mock("@medusajs/medusa/core-flows", () => ({
  completeCartWorkflow: {
    hooks: {
      validate: (fn: any) => {
        validateHandler = fn
      },
    },
  },
}))

import "../block-cancelled-design-order-checkout"

describe("block-cancelled-design-order-checkout", () => {
  it("refuses to complete a cart stamped cancelled", async () => {
    await expect(
      validateHandler({ cart: { id: "cart_1", metadata: { cancelled_at: "2026-10-29T03:00:00.000Z" } } })
    ).rejects.toThrow(/cancelled/)
  })

  it("lets an ordinary cart through", async () => {
    await expect(validateHandler({ cart: { id: "cart_2", metadata: { source: "admin" } } })).resolves.toBeUndefined()
    await expect(validateHandler({ cart: { id: "cart_3", metadata: null } })).resolves.toBeUndefined()
  })

  it("ignores a blank stamp", async () => {
    await expect(validateHandler({ cart: { id: "cart_4", metadata: { cancelled_at: "  " } } })).resolves.toBeUndefined()
  })
})

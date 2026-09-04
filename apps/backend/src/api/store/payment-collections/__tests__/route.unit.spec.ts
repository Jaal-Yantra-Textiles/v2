import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const mockCoreRefresh = jest.fn(async () => ({ result: {} }))
const mockDeleteSessions = jest.fn(async () => ({ result: {} }))
const mockCreateCollectionForCart = jest.fn(async () => ({
  result: { id: "pc_full" },
}))

jest.mock("@medusajs/medusa/core-flows", () => ({
  createPaymentCollectionForCartWorkflow: () => ({
    run: mockCreateCollectionForCart,
  }),
  deletePaymentSessionsWorkflow: () => ({ run: mockDeleteSessions }),
  refreshPaymentCollectionForCartWorkflow: () => ({ run: mockCoreRefresh }),
}))

jest.mock("../../../../modules/payment_schedule", () => ({
  PAYMENT_SCHEDULE_MODULE: "payment_schedule",
}))

const mockRefetchEntity = jest.fn(async () => ({ id: "pc_x", amount: 0 }))

jest.mock("@medusajs/framework/http", () => ({
  refetchEntity: (...args: any[]) => mockRefetchEntity(...(args as [])),
}))

import { POST } from "../route"

/**
 * #1787 — the storefront's OWN checkout door.
 *
 * The deposit seam (#1451) was wired into the hosted Stripe page and the PayU
 * rail, and both were verified. Neither is the door the ordinary checkout uses:
 * `sdk.store.payment.initiatePaymentSession` POSTs `{ cart_id }` to
 * `/store/payment-collections` first, and with no route file there it fell
 * through to core, whose workflow hardcodes `amount: cart.raw_total`.
 *
 * A live AUD quote reached checkout with no deposit line and a demand for the
 * full A$314.77 against a promised A$94.43.
 *
 * 🔑 These assert the AMOUNT the buyer would be charged, not that some helper
 * was called. A test that only checks `ensureCartPaymentCollection` ran would
 * pass against a mock of the very decision under test.
 */
const DEPOSIT_SCHEDULE = {
  id: "sched_au",
  deposit_amount: "94.43",
  total_due: "314.77",
  deposit_status: "pending",
  currency_code: "aud",
}

const buildScope = (cart: any, schedule: any) => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const paymentService = {
    createPaymentCollections: jest.fn(async (input: any[]) => [
      { id: "pc_deposit", ...input[0] },
    ]),
  }
  const link = { create: jest.fn(async () => undefined) }
  const schedules = { findByCartId: jest.fn(async () => schedule) }
  const query = {
    graph: jest.fn(async () => ({ data: cart ? [cart] : [] })),
  }

  const scope = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) return query
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      if (key === ContainerRegistrationKeys.LINK) return link
      if (key === Modules.PAYMENT) return paymentService
      if (key === "payment_schedule") return schedules
      throw new Error(`unexpected resolve(${key})`)
    },
  }

  return { scope, paymentService, link, query }
}

const buildReq = (scope: any, body: any = { cart_id: "cart_au" }) =>
  ({ scope, body, params: {}, queryConfig: {} } as any)

const buildRes = () => {
  const res: any = {}
  res.status = jest.fn(() => res)
  res.json = jest.fn(() => res)
  return res
}

const AU_CART = {
  id: "cart_au",
  currency_code: "aud",
  total: 314.77,
  completed_at: null,
}

beforeEach(() => {
  mockCreateCollectionForCart.mockClear()
  mockRefetchEntity.mockClear()
})

describe("POST /store/payment-collections", () => {
  it("mints the collection at the DEPOSIT, not the cart total", async () => {
    const { scope, paymentService, link } = buildScope(AU_CART, DEPOSIT_SCHEDULE)

    await POST(buildReq(scope), buildRes())

    // 🔴 The assertion that fails against core's workflow: it would have been
    // asked for 314.77, which is what the buyer was actually shown.
    expect(paymentService.createPaymentCollections).toHaveBeenCalledWith([
      { currency_code: "aud", amount: 94.43 },
    ])
    // Core's full-total workflow must not run at all on a deposit cart.
    expect(mockCreateCollectionForCart).not.toHaveBeenCalled()
    // Without the link, `cart.payment_collection` never resolves and the next
    // request mints a SECOND collection.
    expect(link.create).toHaveBeenCalledTimes(1)
  })

  it("leaves an ordinary cart on core's workflow, untouched", async () => {
    const { scope, paymentService } = buildScope(
      { ...AU_CART, id: "cart_plain" },
      null
    )

    await POST(buildReq(scope, { cart_id: "cart_plain" }), buildRes())

    expect(mockCreateCollectionForCart).toHaveBeenCalledTimes(1)
    expect(paymentService.createPaymentCollections).not.toHaveBeenCalled()
  })

  it("refuses a completed cart rather than minting a second charge", async () => {
    const { scope } = buildScope(
      { ...AU_CART, completed_at: "2026-09-04T00:00:00.000Z" },
      DEPOSIT_SCHEDULE
    )

    await expect(POST(buildReq(scope), buildRes())).rejects.toThrow(
      /already completed/i
    )
  })

  it("refuses a body with no cart_id", async () => {
    const { scope } = buildScope(AU_CART, DEPOSIT_SCHEDULE)

    await expect(POST(buildReq(scope, {}), buildRes())).rejects.toThrow(
      /cart_id is required/i
    )
  })

  it("404s an unknown cart", async () => {
    const { scope } = buildScope(null, DEPOSIT_SCHEDULE)

    await expect(POST(buildReq(scope), buildRes())).rejects.toThrow(/not found/i)
  })

  it("returns the collection under the key the SDK reads", async () => {
    const { scope } = buildScope(AU_CART, DEPOSIT_SCHEDULE)
    mockRefetchEntity.mockResolvedValueOnce({
      id: "pc_deposit",
      amount: 94.43,
    } as any)
    const res = buildRes()

    await POST(buildReq(scope), res)

    // 🔴 `initiatePaymentSession` reads `.payment_collection.id` off this
    // response and passes it straight into the session URL. A wrong key is a
    // confident nothing: the SDK would throw on `undefined.id`.
    expect(res.json).toHaveBeenCalledWith({
      payment_collection: { id: "pc_deposit", amount: 94.43 },
    })
  })
})

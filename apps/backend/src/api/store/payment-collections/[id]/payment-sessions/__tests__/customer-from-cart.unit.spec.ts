const runMock = jest.fn().mockResolvedValue({ result: {} })

jest.mock("@medusajs/core-flows", () => ({
  createPaymentSessionsWorkflow: jest.fn(() => ({ run: runMock })),
}))
jest.mock("@medusajs/framework/http", () => ({
  refetchEntity: jest.fn().mockResolvedValue({ id: "pay_col_1" }),
}))
jest.mock(
  "../../../../../../modules/payu-payment/lib/resolve-partner-creds",
  () => ({
    resolvePartnerPayuCredentials: jest.fn().mockResolvedValue(null),
    resolveSalesChannelForCollection: jest.fn().mockResolvedValue(undefined),
    payuContext: jest.fn(() => ({})),
  })
)
jest.mock(
  "../../../../../../modules/stripe-connect-payment/lib/resolve-connect",
  () => ({
    resolvePartnerConnect: jest.fn().mockResolvedValue(null),
    connectContext: jest.fn(() => ({})),
  })
)

const resolveCollectionPaymentContext = jest.fn()
jest.mock("../../../../../../lib/payments/resolve-collection-customer", () => ({
  resolveCollectionPaymentContext: (...a: any[]) =>
    resolveCollectionPaymentContext(...a),
}))

import { POST } from "../route"

const makeRes = () =>
  ({ status: jest.fn().mockReturnThis(), json: jest.fn() }) as any

/**
 * The guest B2B buyer's card must still be attachable (#1792 tail).
 *
 * `auth_context.actor_id` is undefined for a guest, and a quote buyer is
 * DELIBERATELY a guest — the token is the credential, no account required. So
 * reading the customer from auth meant precisely the buyers whose card we want
 * to keep were the ones who never got a Stripe Customer.
 *
 * 🔑 Asserted on `mock.calls` AFTER the call rather than inside the mock: an
 * `expect()` thrown inside a mocked function can be swallowed by a `catch` in
 * the code under test, and the spec then passes while the bug stands.
 */
describe("POST /store/payment-collections/:id/payment-sessions", () => {
  beforeEach(() => {
    runMock.mockClear()
    resolveCollectionPaymentContext.mockReset()
  })

  it("takes the customer from the CART when the caller is a guest", async () => {
    resolveCollectionPaymentContext.mockResolvedValue({
      customer_id: "cus_from_cart",
      plan: { basis: "deposit" },
    })

    await POST(
      {
        params: { id: "pay_col_1" },
        body: { provider_id: "pp_stripe_stripe" },
        scope: { resolve: jest.fn() },
        // No auth_context at all — this IS the guest case.
      } as any,
      makeRes()
    )

    const input = runMock.mock.calls[0][0].input
    expect(input.customer_id).toBe("cus_from_cart")
  })

  it("asks Stripe to keep the card when a balance follows", async () => {
    resolveCollectionPaymentContext.mockResolvedValue({
      customer_id: "cus_from_cart",
      plan: { basis: "deposit" },
    })

    await POST(
      {
        params: { id: "pay_col_1" },
        body: { provider_id: "pp_stripe_stripe" },
        scope: { resolve: jest.fn() },
      } as any,
      makeRes()
    )

    expect(runMock.mock.calls[0][0].input.data).toEqual({
      setup_future_usage: "off_session",
    })
  })

  it("keeps no card when the whole total is being paid now", async () => {
    resolveCollectionPaymentContext.mockResolvedValue({
      customer_id: "cus_from_cart",
      plan: { basis: "full" },
    })

    await POST(
      {
        params: { id: "pay_col_1" },
        body: { provider_id: "pp_stripe_stripe" },
        scope: { resolve: jest.fn() },
      } as any,
      makeRes()
    )

    const data = runMock.mock.calls[0][0].input.data
    expect("setup_future_usage" in data).toBe(false)
  })

  /**
   * A signed-in shopper on a cart with no customer bound must still work —
   * the cart is preferred, but auth remains the fallback, not the other way
   * round.
   */
  it("falls back to the authenticated caller when the cart names nobody", async () => {
    resolveCollectionPaymentContext.mockResolvedValue({
      customer_id: undefined,
      plan: undefined,
    })

    await POST(
      {
        params: { id: "pay_col_1" },
        body: { provider_id: "pp_stripe_stripe" },
        scope: { resolve: jest.fn() },
        auth_context: { actor_id: "cus_signed_in" },
      } as any,
      makeRes()
    )

    expect(runMock.mock.calls[0][0].input.customer_id).toBe("cus_signed_in")
  })
})

/**
 * Provider-level routing tests with Stripe mocked (CI-safe, no network).
 * The connected account + fee are resolved upstream and passed via context
 * (the provider can't reach query/other modules), so these assert the provider
 * honours that context: creates the PaymentIntent ON the account with the fee,
 * and capture/refund re-scope to it.
 */

const mockCreate = jest.fn()
const mockCapture = jest.fn()
const mockRetrieve = jest.fn()
const mockRefund = jest.fn()
const mockUpdate = jest.fn()

jest.mock("stripe", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: mockCreate,
      capture: mockCapture,
      retrieve: mockRetrieve,
      update: mockUpdate,
    },
    refunds: { create: mockRefund },
  })),
}))

import StripeConnectPaymentProviderService from "../service"

const makeService = (providerOptions: any = { apiKey: "sk_test_x" }) => {
  const container: any = {
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  }
  return new StripeConnectPaymentProviderService(container, providerOptions)
}

// context as enriched by resolvePartnerConnect/connectContext upstream.
const connectedInput = (overrides: any = {}) => ({
  amount: 50,
  currency_code: "eur",
  context: {
    sales_channel_id: "sc_1",
    connect_account_id: "acct_partner1",
    connect_partner_id: "partner_1",
    connect_fee_percent: 0.02,
    email: "buyer@example.com",
    ...overrides,
  },
  data: { session_id: "ps_1" },
})

beforeEach(() => {
  jest.clearAllMocks()
  mockCreate.mockResolvedValue({ id: "pi_1", client_secret: "cs_1" })
})

describe("StripeConnectPaymentProvider — routing", () => {
  it("creates the PaymentIntent ON the connected account with the context fee", async () => {
    const svc = makeService()
    const res: any = await svc.initiatePayment(connectedInput() as any)

    expect(mockCreate).toHaveBeenCalledTimes(1)
    const [body, options] = mockCreate.mock.calls[0]
    // €50.00 → 5000 cents; 2% → 100 cents fee
    expect(body).toMatchObject({ amount: 5000, currency: "eur", application_fee_amount: 100 })
    // The crucial bit: charged on the connected account, not the platform.
    expect(options).toEqual({ stripeAccount: "acct_partner1" })

    expect(res.data).toMatchObject({
      id: "pi_1",
      connect_account_id: "acct_partner1",
      partner_id: "partner_1",
      application_fee_amount: 100,
      connected: true,
    })
  })

  it("uses the fee rate from context (4% Starter tier)", async () => {
    const svc = makeService()
    await svc.initiatePayment(connectedInput({ connect_fee_percent: 0.04 }) as any)
    expect(mockCreate.mock.calls[0][0].application_fee_amount).toBe(200) // 4% of 5000
  })

  it("omits the fee when the rate is 0 and no default", async () => {
    const svc = makeService()
    await svc.initiatePayment(connectedInput({ connect_fee_percent: 0 }) as any)
    expect(mockCreate.mock.calls[0][0].application_fee_amount).toBeUndefined()
  })

  it("falls back to options.defaultFeePercent when context carries no rate", async () => {
    const svc = makeService({ apiKey: "sk_test_x", defaultFeePercent: 0.03 })
    await svc.initiatePayment(connectedInput({ connect_fee_percent: undefined }) as any)
    expect(mockCreate.mock.calls[0][0].application_fee_amount).toBe(150) // 3% of 5000
  })

  it("REGRESSION: throws when context has no connected account (routing unresolved)", async () => {
    const svc = makeService()
    await expect(
      svc.initiatePayment(connectedInput({ connect_account_id: undefined }) as any)
    ).rejects.toThrow(/no active Stripe Connect account/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("falls back to a platform charge (no fee) when allowPlatformFallback is set", async () => {
    const svc = makeService({ apiKey: "sk_test_x", allowPlatformFallback: true })
    const res: any = await svc.initiatePayment(
      connectedInput({ connect_account_id: undefined }) as any
    )
    const [body, options] = mockCreate.mock.calls[0]
    expect(body.amount).toBe(5000)
    expect(body.application_fee_amount).toBeUndefined()
    expect(options).toBeUndefined() // no stripeAccount → platform account
    expect(res.data.connected).toBe(false)
  })
})

describe("StripeConnectPaymentProvider — capture/refund re-scope to the account", () => {
  it("captures on the connected account", async () => {
    const svc = makeService()
    mockCapture.mockResolvedValue({ status: "succeeded" })
    await svc.capturePayment({
      data: { id: "pi_1", connect_account_id: "acct_partner1" },
    } as any)
    expect(mockCapture).toHaveBeenCalledWith("pi_1", {}, { stripeAccount: "acct_partner1" })
  })

  it("refunds on the connected account and hands back the application fee", async () => {
    const svc = makeService()
    mockRefund.mockResolvedValue({ id: "re_1" })
    await svc.refundPayment({
      amount: 10,
      data: { id: "pi_1", connect_account_id: "acct_partner1", currency: "eur" },
    } as any)
    const [body, options] = mockRefund.mock.calls[0]
    expect(body).toMatchObject({
      payment_intent: "pi_1",
      amount: 1000, // €10.00
      refund_application_fee: true,
    })
    expect(options).toEqual({ stripeAccount: "acct_partner1" })
  })
})

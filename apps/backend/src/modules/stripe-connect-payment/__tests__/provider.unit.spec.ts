/**
 * Provider-level routing tests with Stripe + container mocked (CI-safe, no
 * network). Asserts the behaviour that the pure fee tests can't: that a cart's
 * sales_channel resolves to the partner's connected account and the PaymentIntent
 * is created ON that account with the plan-derived application fee. This is the
 * test that would have caught the "sales_channel_id never reaches the provider"
 * routing bug.
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

type MockOpts = {
  connectAccountId?: string | null
  chargesEnabled?: boolean
  feature?: any
}

const makeService = (
  opts: MockOpts = {},
  providerOptions: any = { apiKey: "sk_test_x" }
) => {
  const {
    connectAccountId = "acct_partner1",
    chargesEnabled = true,
    feature = { payment_processing_fee: "2%" },
  } = opts

  const query = {
    graph: jest.fn(async ({ entity }: any) => {
      if (entity === "store") {
        return { data: [{ id: "store_1", partner: { id: "partner_1" } }] }
      }
      if (entity === "partner_subscription") {
        return { data: [{ id: "sub_1", plan: { features: feature } }] }
      }
      return { data: [] }
    }),
  }

  const configService = {
    listPartnerPaymentConfigs: jest.fn(async () =>
      connectAccountId
        ? [
            {
              id: "cfg_1",
              partner_id: "partner_1",
              connect_account_id: connectAccountId,
              connect_charges_enabled: chargesEnabled,
            },
          ]
        : []
    ),
  }

  const container: any = {
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    resolve: (name: string) =>
      name === "query" ? query : name === "partner_payment_config" ? configService : undefined,
  }

  const svc = new StripeConnectPaymentProviderService(container, providerOptions)
  return { svc, query, configService }
}

const baseInput = {
  amount: 50,
  currency_code: "eur",
  context: { sales_channel_id: "sc_1", email: "buyer@example.com" },
  data: { session_id: "ps_1" },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCreate.mockResolvedValue({ id: "pi_1", client_secret: "cs_1" })
})

describe("StripeConnectPaymentProvider — routing", () => {
  it("creates the PaymentIntent ON the connected account with the plan fee", async () => {
    const { svc } = makeService()
    const res: any = await svc.initiatePayment(baseInput as any)

    expect(mockCreate).toHaveBeenCalledTimes(1)
    const [body, options] = mockCreate.mock.calls[0]
    // €50.00 → 5000 cents; 2% → 100 cents fee
    expect(body).toMatchObject({
      amount: 5000,
      currency: "eur",
      application_fee_amount: 100,
    })
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

  it("uses the partner's plan tier for the fee (4% Starter)", async () => {
    const { svc } = makeService({ feature: { payment_processing_fee: "4%" } })
    await svc.initiatePayment(baseInput as any)
    expect(mockCreate.mock.calls[0][0].application_fee_amount).toBe(200) // 4% of 5000
  })

  it("omits the fee when the plan can't be resolved and no default", async () => {
    const { svc } = makeService({ feature: null })
    await svc.initiatePayment(baseInput as any)
    expect(mockCreate.mock.calls[0][0].application_fee_amount).toBeUndefined()
  })

  it("REGRESSION: throws when sales_channel_id is absent (routing can't resolve)", async () => {
    const { svc } = makeService()
    await expect(
      svc.initiatePayment({ ...baseInput, context: { email: "x@y.com" } } as any)
    ).rejects.toThrow(/no active Stripe Connect account/i)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("throws when the partner has no charge-enabled account (Connect wins when active)", async () => {
    const { svc } = makeService({ chargesEnabled: false })
    await expect(svc.initiatePayment(baseInput as any)).rejects.toThrow(
      /no active Stripe Connect account/i
    )
  })

  it("falls back to a platform charge (no fee) when allowPlatformFallback is set", async () => {
    const { svc } = makeService(
      { connectAccountId: null },
      { apiKey: "sk_test_x", allowPlatformFallback: true }
    )
    const res: any = await svc.initiatePayment(baseInput as any)
    const [body, options] = mockCreate.mock.calls[0]
    expect(body.amount).toBe(5000)
    expect(body.application_fee_amount).toBeUndefined()
    expect(options).toBeUndefined() // no stripeAccount → platform account
    expect(res.data.connected).toBe(false)
  })
})

describe("StripeConnectPaymentProvider — capture/refund re-scope to the account", () => {
  it("captures on the connected account", async () => {
    const { svc } = makeService()
    mockCapture.mockResolvedValue({ status: "succeeded" })
    await svc.capturePayment({
      data: { id: "pi_1", connect_account_id: "acct_partner1" },
    } as any)
    expect(mockCapture).toHaveBeenCalledWith("pi_1", {}, { stripeAccount: "acct_partner1" })
  })

  it("refunds on the connected account and hands back the application fee", async () => {
    const { svc } = makeService()
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

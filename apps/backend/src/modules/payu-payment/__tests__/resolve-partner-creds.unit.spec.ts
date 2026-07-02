import {
  payuContext,
  resolvePartnerPayuCredentials,
  resolveSalesChannelForCollection,
} from "../lib/resolve-partner-creds"

/** Minimal scope whose `query.graph` returns queued responses by call order. */
function makeScope(opts: {
  graphResponses?: any[]
  configs?: any[]
}) {
  const graph = jest.fn()
  ;(opts.graphResponses ?? []).forEach((r) => graph.mockResolvedValueOnce(r))
  const configService = {
    listPartnerPaymentConfigs: jest.fn().mockResolvedValue(opts.configs ?? []),
  }
  const scope = {
    resolve: (key: string) => {
      if (key === "partner_payment_config") return configService
      return { graph }
    },
  }
  return { scope, graph, configService }
}

describe("payuContext", () => {
  it("is empty for null", () => {
    expect(payuContext(null)).toEqual({})
  })

  it("carries key/salt/partner and omits mode when absent", () => {
    expect(
      payuContext({
        partner_id: "p1",
        merchant_key: "K",
        merchant_salt: "S",
      })
    ).toEqual({
      payu_partner_id: "p1",
      payu_merchant_key: "K",
      payu_merchant_salt: "S",
    })
  })

  it("includes mode when set", () => {
    expect(
      payuContext({
        partner_id: "p1",
        merchant_key: "K",
        merchant_salt: "S",
        mode: "live",
      })
    ).toMatchObject({ payu_mode: "live" })
  })
})

describe("resolvePartnerPayuCredentials", () => {
  it("returns null without a sales channel", async () => {
    const { scope } = makeScope({})
    expect(await resolvePartnerPayuCredentials(scope, undefined)).toBeNull()
  })

  it("returns null when the sales channel has no owning partner", async () => {
    const { scope } = makeScope({ graphResponses: [{ data: [] }] })
    expect(await resolvePartnerPayuCredentials(scope, "sc_1")).toBeNull()
  })

  it("returns null when the partner has no usable PayU config", async () => {
    const { scope } = makeScope({
      graphResponses: [{ data: [{ id: "store_1", partner: { id: "p1" } }] }],
      configs: [{ credentials: { merchant_key: "K" } }], // missing salt
    })
    expect(await resolvePartnerPayuCredentials(scope, "sc_1")).toBeNull()
  })

  it("returns partner credentials when configured", async () => {
    const { scope, configService } = makeScope({
      graphResponses: [{ data: [{ id: "store_1", partner: { id: "p1" } }] }],
      configs: [
        { credentials: { merchant_key: "K", merchant_salt: "S", mode: "test" } },
      ],
    })
    expect(await resolvePartnerPayuCredentials(scope, "sc_1")).toEqual({
      partner_id: "p1",
      merchant_key: "K",
      merchant_salt: "S",
      mode: "test",
    })
    expect(configService.listPartnerPaymentConfigs).toHaveBeenCalledWith({
      partner_id: "p1",
      provider_id: "pp_payu_payu",
      is_active: true,
    })
  })
})

describe("resolveSalesChannelForCollection", () => {
  it("walks the cart_payment_collection link to the cart's sales channel", async () => {
    const { scope, graph } = makeScope({
      graphResponses: [
        { data: [{ cart_id: "cart_1" }] },
        { data: [{ sales_channel_id: "sc_9" }] },
      ],
    })
    expect(await resolveSalesChannelForCollection(scope, "paycol_1")).toBe("sc_9")
    expect(graph.mock.calls[0][0]).toMatchObject({
      entity: "cart_payment_collection",
      filters: { payment_collection_id: "paycol_1" },
    })
  })

  it("returns undefined when the collection has no linked cart", async () => {
    const { scope } = makeScope({ graphResponses: [{ data: [] }] })
    expect(await resolveSalesChannelForCollection(scope, "paycol_x")).toBeUndefined()
  })
})

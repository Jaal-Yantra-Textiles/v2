import { paymentNextAction, pickSession } from "../registry"

describe("paymentNextAction — provider normalization", () => {
  it("PayU → a redirect form with the hosted link and signed fields", () => {
    const session = {
      provider_id: "pp_payu_payu",
      data: {
        payment_url: "https://test.payu.in/_payment",
        key: "mkey",
        txnid: "medusa_123_abcd",
        amount: "1499.00",
        productinfo: "Order medusa_123_abcd",
        firstname: "Asha",
        email: "asha@example.in",
        phone: "9999999999",
        udf1: "ps_1",
        hash: "deadbeef",
        currency: "INR",
        status: "pending",
      },
    }
    const next = paymentNextAction(session)
    expect(next.type).toBe("redirect_form")
    expect(next.provider).toBe("payu")
    expect(next.method).toBe("POST")
    expect(next.url).toBe("https://test.payu.in/_payment")
    expect(next.fields.key).toBe("mkey")
    expect(next.fields.txnid).toBe("medusa_123_abcd")
    expect(next.fields.hash).toBe("deadbeef")
    expect(next.fields.amount).toBe("1499.00")
    expect(next.txnid).toBe("medusa_123_abcd")
  })

  it("Stripe → the client_secret to collect the card client-side", () => {
    const session = {
      provider_id: "pp_stripe_stripe",
      data: { client_secret: "pi_123_secret_abc", id: "pi_123" },
    }
    const next = paymentNextAction(session)
    expect(next.type).toBe("client_secret")
    expect(next.provider).toBe("stripe")
    expect(next.client_secret).toBe("pi_123_secret_abc")
  })

  it("manual/system → session_ready (no client action)", () => {
    const next = paymentNextAction({ provider_id: "pp_system_default", data: {} })
    expect(next.type).toBe("session_ready")
    expect(next.provider_id).toBe("pp_system_default")
  })

  it("missing provider data degrades to nulls, never throws", () => {
    const next = paymentNextAction({ provider_id: "pp_payu_payu" })
    expect(next.type).toBe("redirect_form")
    expect(next.url).toBeNull()
    expect(next.fields.hash).toBeNull()
  })
})

describe("pickSession — locate the initialized session on a collection", () => {
  const data = {
    payment_collection: {
      payment_sessions: [
        { provider_id: "pp_system_default", data: {} },
        { provider_id: "pp_payu_payu", data: { txnid: "t1" } },
      ],
    },
  }

  it("matches by exact provider_id", () => {
    expect(pickSession(data, "pp_payu_payu").data.txnid).toBe("t1")
  })

  it("matches by provider substring (e.g. 'payu')", () => {
    expect(pickSession(data, "payu").data.txnid).toBe("t1")
  })

  it("falls back to the last session when nothing matches", () => {
    expect(pickSession(data, "nope").provider_id).toBe("pp_payu_payu")
  })

  it("returns null for an empty/absent collection", () => {
    expect(pickSession({}, "pp_payu_payu")).toBeNull()
  })
})

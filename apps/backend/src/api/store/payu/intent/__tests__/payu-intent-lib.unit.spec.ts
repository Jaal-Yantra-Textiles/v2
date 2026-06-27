import {
  buildUpiIntentForm,
  buildReturnUrls,
  findPayuSession,
  parseUpiIntentResponse,
} from "../lib"

describe("buildUpiIntentForm", () => {
  const session = {
    key: "Shrwii",
    txnid: "mcp_123",
    amount: "1.00",
    productinfo: "Order mcp_123",
    firstname: "Asha",
    email: "asha@example.in",
    phone: "9999999999",
    udf1: "ps_1",
    hash: "deadbeef",
    payment_url: "https://test.payu.in/_payment",
  }

  it("replays the signed session fields and adds the UPI-intent switches", () => {
    const f = buildUpiIntentForm(session, { surl: "https://s/ok", furl: "https://s/no" })
    expect(f.key).toBe("Shrwii")
    expect(f.txnid).toBe("mcp_123")
    expect(f.hash).toBe("deadbeef")
    expect(f.udf1).toBe("ps_1")
    expect(f.pg).toBe("UPI")
    expect(f.bankcode).toBe("INTENT")
    expect(f.txn_s2s_flow).toBe("4")
    expect(f.surl).toBe("https://s/ok")
    expect(f.furl).toBe("https://s/no")
    // sensible defaults so PayU doesn't reject the S2S call
    expect(f.s2s_client_ip).toBe("127.0.0.1")
    expect(f.s2s_device_info).toBe("Mozilla/5.0")
  })

  it("includes upiAppName only when provided, and uses given ip/device", () => {
    const f = buildUpiIntentForm(session, {
      surl: "x",
      furl: "y",
      clientIp: "1.2.3.4",
      deviceInfo: "UA/1",
      upiAppName: "phonepe",
    })
    expect(f.upiAppName).toBe("phonepe")
    expect(f.s2s_client_ip).toBe("1.2.3.4")
    expect(f.s2s_device_info).toBe("UA/1")

    const f2 = buildUpiIntentForm(session, { surl: "x", furl: "y" })
    expect(f2.upiAppName).toBeUndefined()
  })
})

describe("parseUpiIntentResponse", () => {
  it("prefixes upi://pay? when intentURIData has no scheme", () => {
    const p = parseUpiIntentResponse({
      metaData: { txnStatus: "pending" },
      result: { paymentId: "403993715537778288", intentURIData: "pa=payu@hdfc&am=1.00&cu=INR" },
    })
    expect(p.upi_link).toBe("upi://pay?pa=payu@hdfc&am=1.00&cu=INR")
    expect(p.payment_id).toBe("403993715537778288")
    expect(p.txn_status).toBe("pending")
  })

  it("keeps an already-formed upi:// uri and surfaces a QR url", () => {
    const p = parseUpiIntentResponse({
      result: { intentUri: "upi://pay?pa=x", intentUrlWithQR: "https://payu.in/q?qr=1" },
    })
    expect(p.upi_link).toBe("upi://pay?pa=x")
    expect(p.qr_url).toBe("https://payu.in/q?qr=1")
  })

  it("returns null link when PayU gave no intent data", () => {
    const p = parseUpiIntentResponse({ status: 0, message: "nope" })
    expect(p.upi_link).toBeNull()
    expect(p.qr_url).toBeNull()
  })
})

describe("findPayuSession", () => {
  it("finds the pp_payu session among others", () => {
    const cart = {
      payment_collection: {
        payment_sessions: [
          { id: "ps_1", provider_id: "pp_system_default" },
          { id: "ps_2", provider_id: "pp_payu_payu", data: { txnid: "t" } },
        ],
      },
    }
    expect(findPayuSession(cart)?.id).toBe("ps_2")
  })

  it("returns null when there is no PayU session / no collection", () => {
    expect(findPayuSession({ payment_collection: { payment_sessions: [] } })).toBeNull()
    expect(findPayuSession({})).toBeNull()
  })
})

describe("buildReturnUrls", () => {
  it("builds surl/furl with the cart id and strips a trailing slash", () => {
    const { surl, furl } = buildReturnUrls("https://acme.cicilabel.com/", "cart_9")
    expect(surl).toBe("https://acme.cicilabel.com/api/payu/success?cart_id=cart_9")
    expect(furl).toBe("https://acme.cicilabel.com/api/payu/failure?cart_id=cart_9")
  })

  it("tolerates a null origin", () => {
    const { surl } = buildReturnUrls(null, "cart_9")
    expect(surl).toBe("/api/payu/success?cart_id=cart_9")
  })
})

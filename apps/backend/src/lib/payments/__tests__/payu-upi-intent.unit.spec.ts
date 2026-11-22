import { createHash } from "crypto"

import {
  buildUpiIntentRequest,
  isUpiIntentUri,
  mintPayuUpiIntent,
  payuPaymentUrl,
} from "../payu-upi-intent"
import { qrPayloadFor } from "../payu-link-expiry"

const sha = (s: string) => createHash("sha512").update(s).digest("hex")

// The live response shape PayU returned on 2026-11-22 for our MID (trimmed).
const livePending = {
  metaData: { message: null, txnStatus: "pending", unmappedStatus: "pending" },
  result: {
    paymentId: "31956648465",
    amount: "1100.00",
    intentURIData:
      "pa=JAALYANTRATEXTILESPRIV-13285163.payu@indus&pn=JAAL YANTRA TEXTILES PRIVATE LIMITED&tr=31956648465&am=1100.00&cu=INR&tn=UPIIntent",
  },
}

const fetchReturning = (body: string, status = 200) =>
  jest.fn(async () => ({ status, text: async () => body })) as any

const env = { PAYU_MERCHANT_KEY: "KEY123", PAYU_MERCHANT_SALT: "SALT", PAYU_MODE: "live" }

describe("buildUpiIntentRequest", () => {
  it("signs the classic _payment hash with the cart id in udf1", () => {
    const form = buildUpiIntentRequest({
      key: "KEY123",
      salt: "SALT",
      txnid: "upitx1",
      amount: "1100.00",
      cartId: "cart_01",
      email: "b@x.com",
      firstname: "Asha",
      phone: "9876543210",
      productinfo: "Order cart_01",
    })
    expect(form.hash).toBe(
      sha("KEY123|upitx1|1100.00|Order cart_01|Asha|b@x.com|cart_01||||||||||SALT")
    )
    expect(form).toMatchObject({
      udf1: "cart_01",
      pg: "UPI",
      bankcode: "INTENT",
      txn_s2s_flow: "4",
    })
  })

  it("posts to secure.payu.in only in live mode", () => {
    expect(payuPaymentUrl("live")).toBe("https://secure.payu.in/_payment")
    expect(payuPaymentUrl("test")).toBe("https://test.payu.in/_payment")
    expect(payuPaymentUrl(undefined)).toBe("https://test.payu.in/_payment")
  })
})

describe("mintPayuUpiIntent", () => {
  it("returns a upi://pay intent for the amount due, spaces encoded", async () => {
    const fetchImpl = fetchReturning(JSON.stringify(livePending))
    const out = await mintPayuUpiIntent(
      { cartId: "cart_01", amount: 1100, email: "b@x.com", firstName: "Asha", phone: "+91 98765 43210" },
      { env, fetchImpl }
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.intent.uri).toBe(
      "upi://pay?pa=JAALYANTRATEXTILESPRIV-13285163.payu@indus&pn=JAAL%20YANTRA%20TEXTILES%20PRIVATE%20LIMITED&tr=31956648465&am=1100.00&cu=INR&tn=UPIIntent"
    )
    expect(out.intent.amount).toBe(1100)
    expect(out.intent.payment_id).toBe("31956648465")
    expect(isUpiIntentUri(out.intent.uri)).toBe(true)

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://secure.payu.in/_payment")
    const sent = new URLSearchParams(init.body)
    expect(sent.get("amount")).toBe("1100.00")
    expect(sent.get("udf1")).toBe("cart_01")
    expect(sent.get("phone")).toBe("9876543210")
    expect(sent.get("txnid")!.length).toBeLessThanOrEqual(25)
  })

  it("fails soft when PayU answers with its hosted HTML page (S2S not enabled)", async () => {
    const out = await mintPayuUpiIntent(
      { cartId: "cart_01", amount: 1100 },
      { env, fetchImpl: fetchReturning("<html>PayU</html>") }
    )
    expect(out).toEqual({ ok: false, error: expect.stringContaining("did not return JSON") })
  })

  it("fails soft on a failed txn status, even if a URI-ish field is present", async () => {
    const failed = {
      metaData: { txnStatus: "failed", statusCode: "E6001" },
      result: { intentURIData: "pa=x@y&am=1.00" },
    }
    const out = await mintPayuUpiIntent(
      { cartId: "cart_01", amount: 1 },
      { env, fetchImpl: fetchReturning(JSON.stringify(failed)) }
    )
    expect(out.ok).toBe(false)
  })

  it("never calls PayU without credentials or with a non-positive amount", async () => {
    const fetchImpl = fetchReturning("{}")
    expect((await mintPayuUpiIntent({ cartId: "c", amount: 10 }, { env: {}, fetchImpl })).ok).toBe(false)
    expect((await mintPayuUpiIntent({ cartId: "c", amount: 0 }, { env, fetchImpl })).ok).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("fails soft when fetch throws", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("ECONNRESET")
    }) as any
    const out = await mintPayuUpiIntent({ cartId: "c", amount: 10 }, { env, fetchImpl })
    expect(out).toEqual({ ok: false, error: "ECONNRESET" })
  })
})

describe("qrPayloadFor", () => {
  const base = {
    invoice_number: "inv1",
    url: "https://u.payu.in/abc",
    expires_at: "2026-11-24T00:00:00.000Z",
    created_at: "2026-11-22T00:00:00.000Z",
  }

  it("encodes the UPI intent when one was minted", () => {
    expect(
      qrPayloadFor({
        ...base,
        upi_intent: { txnid: "t", uri: "upi://pay?pa=a@b&am=1.00", amount: 1, payment_id: null, created_at: "" },
      })
    ).toEqual({ kind: "upi", data: "upi://pay?pa=a@b&am=1.00" })
  })

  it("falls back to the link URL without an intent (old carts, failed mint)", () => {
    expect(qrPayloadFor(base)).toEqual({ kind: "link", data: "https://u.payu.in/abc" })
    expect(qrPayloadFor({ ...base, upi_intent: null })).toEqual({ kind: "link", data: base.url })
  })
})

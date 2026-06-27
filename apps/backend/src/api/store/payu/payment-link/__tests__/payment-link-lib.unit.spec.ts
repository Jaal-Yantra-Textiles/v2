import { createHash } from "crypto"
import {
  buildPaymentLinkBody,
  isLinkPaid,
  oneapiHosts,
  oneapiLinkTxnsUrl,
  parsePaymentLinkResponse,
  verifyWebhookHash,
} from "../lib"

const sha512Hex = (s: string) => createHash("sha512").update(s).digest("hex")

describe("buildPaymentLinkBody", () => {
  it("coerces subAmount to an int ≥1, caps invoiceNumber at 16, sets source API", () => {
    const b = buildPaymentLinkBody({
      amount: "1499.7",
      description: "Order x",
      invoiceNumber: "this-invoice-number-is-way-too-long",
    })
    expect(b.subAmount).toBe(1500)
    expect(b.source).toBe("API")
    expect(b.invoiceNumber.length).toBe(16)
    expect(b.subAmount).toBeGreaterThanOrEqual(1)
  })

  it("floors a sub-1 amount to 1 and includes customer only when present", () => {
    const b = buildPaymentLinkBody({ amount: 0 })
    expect(b.subAmount).toBe(1)
    expect(b.customer).toBeUndefined()
    const b2 = buildPaymentLinkBody({ amount: 5, customer: { email: "a@b.c" } })
    expect(b2.customer).toEqual({ name: undefined, email: "a@b.c", mobileNumber: undefined })
  })

  it("carries cartId as nested udf.udf1 for webhook mapping", () => {
    const b = buildPaymentLinkBody({ amount: 5, cartId: "cart_123" })
    expect(b.udf).toEqual({ udf1: "cart_123", udf2: null, udf3: null, udf4: null, udf5: null })
  })
})

describe("parsePaymentLinkResponse", () => {
  it("extracts the shareable link + invoice", () => {
    const p = parsePaymentLinkResponse({
      status: 0,
      message: "PaymentLink generated",
      result: { paymentLink: "https://v.payu.in/PAYUMN/abc", invoiceNumber: "inv1", totalAmount: 1, active: true },
    })
    expect(p.payment_link).toBe("https://v.payu.in/PAYUMN/abc")
    expect(p.invoice_number).toBe("inv1")
    expect(p.active).toBe(true)
  })
})

describe("oneapiHosts / oneapiLinkTxnsUrl", () => {
  it("selects UAT by default and prod for live/prod", () => {
    expect(oneapiHosts("test").links).toContain("uatoneapi")
    expect(oneapiHosts(undefined).links).toContain("uatoneapi")
    expect(oneapiHosts("prod").links).toBe("https://oneapi.payu.in/payment-links")
    expect(oneapiHosts("live").links).toBe("https://oneapi.payu.in/payment-links")
  })

  it("builds the txns lookup url with the invoice path param", () => {
    const u = oneapiLinkTxnsUrl("prod", "inv 1")
    expect(u).toContain("https://oneapi.payu.in/payment-links/inv%201/txns")
    expect(u).toContain("dateFrom=")
  })
})

describe("verifyWebhookHash (reverse SHA512)", () => {
  const salt = "TESTSALT"
  const base = {
    status: "success",
    udf1: "cart_9",
    udf2: "",
    udf3: "",
    udf4: "",
    udf5: "",
    email: "a@b.c",
    firstname: "Asha",
    productinfo: "Order cart_9",
    amount: "1.00",
    txnid: "txn_1",
    key: "Shrwii",
  }
  const signFor = (p: any) => {
    const tail = [
      p.status, "", "", "", "", "",
      p.udf5, p.udf4, p.udf3, p.udf2, p.udf1,
      p.email, p.firstname, p.productinfo, p.amount, p.txnid, p.key,
    ]
    return sha512Hex([salt, ...tail].join("|"))
  }

  it("accepts a correctly reverse-hashed payload", () => {
    const payload = { ...base, hash: signFor(base) }
    expect(verifyWebhookHash(payload, salt, sha512Hex)).toBe(true)
  })

  it("rejects a tampered amount", () => {
    const payload = { ...base, hash: signFor(base), amount: "9999.00" }
    expect(verifyWebhookHash(payload, salt, sha512Hex)).toBe(false)
  })

  it("rejects when hash or salt missing", () => {
    expect(verifyWebhookHash({ ...base }, salt, sha512Hex)).toBe(false)
    expect(verifyWebhookHash({ ...base, hash: "x" }, "", sha512Hex)).toBe(false)
  })
})

describe("isLinkPaid", () => {
  const txns = (rows: any[]) => ({ status: 0, result: { data: rows } })

  it("is paid when a success txn covers the min amount", () => {
    const r = isLinkPaid(txns([{ status: "success", settledAmount: 1500, transactionId: "t1", mode: "UPI" }]), 1500)
    expect(r.paid).toBe(true)
    expect(r.transaction_id).toBe("t1")
    expect(r.mode).toBe("UPI")
  })

  it("is NOT paid when settled is short of the min amount", () => {
    const r = isLinkPaid(txns([{ status: "success", settledAmount: 100 }]), 1500)
    expect(r.paid).toBe(false)
    expect(r.settled_amount).toBe(100)
  })

  it("is NOT paid with no success row", () => {
    expect(isLinkPaid(txns([{ status: "failed" }])).paid).toBe(false)
    expect(isLinkPaid(txns([])).paid).toBe(false)
  })
})

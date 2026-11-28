import crypto from "crypto"
import BtcpayPaymentProviderService from "../service"
import { btcpaySignatureValid, invoiceVerdict, storeWebhookSecret } from "../lib/verdict"

/**
 * The rule these pin: only an invoice fetched FROM BTCPay, carrying THIS
 * session's id, Settled for the full amount, places an order. Session data is
 * buyer-writable (#2656 for PayU), so an invoice id in it is only a claim.
 */

const OPTS = {
  server_url: "https://btcpay.example.com",
  api_key: "k",
  store_id: "STORE_OURS",
  webhook_secret: "master",
}
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any
const make = () => new BtcpayPaymentProviderService({ logger }, OPTS)

const inv = (over: Record<string, any> = {}) => ({
  id: "INV1",
  storeId: "STORE_OURS",
  status: "Settled",
  additionalStatus: "None",
  amount: "1950.00",
  currency: "INR",
  checkoutLink: "https://btcpay.example.com/i/INV1",
  metadata: { medusa_session_id: "payses_1" },
  ...over,
})
const expect1 = { sessionId: "payses_1", amount: 1950, currency: "INR", storeId: "STORE_OURS" }

describe("invoiceVerdict", () => {
  it("settled, full amount, this session → paid", () => {
    expect(invoiceVerdict(inv(), expect1).verdict).toBe("paid")
  })
  it("someone else's settled invoice → failed (the swap attack)", () => {
    expect(invoiceVerdict(inv({ metadata: { medusa_session_id: "payses_OTHER" } }), expect1).verdict).toBe("failed")
  })
  it("an invoice with no session id → failed", () => {
    expect(invoiceVerdict(inv({ metadata: {} }), expect1).verdict).toBe("failed")
  })
  it("cheaper invoice → review, never paid", () => {
    expect(invoiceVerdict(inv({ amount: "10.00" }), expect1).verdict).toBe("review")
  })
  it("wrong currency or store → failed", () => {
    expect(invoiceVerdict(inv({ currency: "USD" }), expect1).verdict).toBe("failed")
    expect(invoiceVerdict(inv({ storeId: "STORE_X" }), expect1).verdict).toBe("failed")
  })
  it("Processing (unconfirmed) → pending; Expired unpaid → failed; Expired PaidLate → review", () => {
    expect(invoiceVerdict(inv({ status: "Processing" }), expect1).verdict).toBe("pending")
    expect(invoiceVerdict(inv({ status: "Expired" }), expect1).verdict).toBe("failed")
    expect(invoiceVerdict(inv({ status: "Expired", additionalStatus: "PaidLate" }), expect1).verdict).toBe("review")
  })
  it("Settled but PaidPartial → review", () => {
    expect(invoiceVerdict(inv({ additionalStatus: "PaidPartial" }), expect1).verdict).toBe("review")
  })
})

describe("webhook signature", () => {
  const body = JSON.stringify({ type: "InvoiceSettled", storeId: "STORE_OURS", invoiceId: "INV1" })
  const secret = storeWebhookSecret("master", "STORE_OURS")
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex")

  it("accepts BTCPay's sha256 HMAC of the raw body", () => {
    expect(btcpaySignatureValid(body, sig, secret)).toBe(true)
  })
  it("rejects a tampered body, a missing header, and another store's secret", () => {
    expect(btcpaySignatureValid(body.replace("INV1", "INV2"), sig, secret)).toBe(false)
    expect(btcpaySignatureValid(body, undefined, secret)).toBe(false)
    expect(btcpaySignatureValid(body, sig, storeWebhookSecret("master", "STORE_PARTNER"))).toBe(false)
  })
})

describe("BtcpayPaymentProviderService against a faked BTCPay", () => {
  const realFetch = global.fetch
  let invoice: any
  let calls: { method: string; url: string; body?: any }[]

  beforeEach(() => {
    calls = []
    invoice = inv()
    global.fetch = (async (url: any, init?: any) => {
      const u = String(url)
      const method = init?.method || "GET"
      calls.push({ method, url: u, body: init?.body ? JSON.parse(init.body) : undefined })
      const json = (d: any) => new Response(JSON.stringify(d), { status: 200 })
      if (method === "POST" && /\/invoices$/.test(u)) return json(inv({ status: "New", metadata: JSON.parse(init.body).metadata }))
      if (method === "GET" && /\/invoices\/INV1$/.test(u)) return json(invoice)
      if (method === "POST" && /\/invoices\/INV1\/status$/.test(u)) return json({ ...invoice, status: "Invalid" })
      return new Response("nope", { status: 404 })
    }) as any
  })
  afterEach(() => {
    global.fetch = realFetch
  })

  it("initiate: invoice in the cart currency, in the partner's store when given, tagged with the session id", async () => {
    const out = await make().initiatePayment({
      amount: 1950,
      currency_code: "inr",
      data: { session_id: "payses_1", return_url: "https://cicilabel.com/in/btc/return" },
      context: { btcpay_store_id: "STORE_PARTNER", btcpay_partner_id: "partner_1" },
    } as any)
    const create = calls.find((c) => c.method === "POST")!
    expect(create.url).toBe("https://btcpay.example.com/api/v1/stores/STORE_PARTNER/invoices")
    expect(create.body).toMatchObject({ amount: "1950.00", currency: "INR", metadata: { medusa_session_id: "payses_1" } })
    expect(create.body.checkout.redirectURL).toBe("https://cicilabel.com/in/btc/return")
    expect(out.data).toMatchObject({ invoice_id: "INV1", btcpay_store_id: "STORE_PARTNER", amount: "1950.00" })
  })

  it("initiate without a partner store uses OURS", async () => {
    await make().initiatePayment({ amount: 10, currency_code: "eur", data: { session_id: "s" }, context: {} } as any)
    expect(calls[0].url).toContain("/stores/STORE_OURS/invoices")
  })

  const sessionData = { invoice_id: "INV1", btcpay_store_id: "STORE_OURS", session_id: "payses_1", amount: "1950.00", currency: "INR" }

  it("authorize: settled invoice for this session → captured", async () => {
    const r = await make().authorizePayment({ data: sessionData } as any)
    expect(r.status).toBe("captured")
  })

  it("authorize: a buyer who swapped in another session's paid invoice gets an error, not an order", async () => {
    invoice = inv({ metadata: { medusa_session_id: "payses_SOMEONE_ELSE" } })
    const r = await make().authorizePayment({ data: sessionData } as any)
    expect(r.status).toBe("error")
  })

  it("authorize: the buyer's own data claiming 'Settled' changes nothing — BTCPay says Processing", async () => {
    invoice = inv({ status: "Processing" })
    const r = await make().authorizePayment({ data: { ...sessionData, status: "captured", btcpay_status: "Settled" } } as any)
    expect(r.status).toBe("pending")
  })

  it("authorize: BTCPay unreachable → pending (never paid by default)", async () => {
    global.fetch = (async () => new Response("down", { status: 503 })) as any
    const r = await make().authorizePayment({ data: sessionData } as any)
    expect(r.status).toBe("pending")
  })

  it("deleting a session retires its still-unpaid invoice (no orphan payable invoice)", async () => {
    invoice = inv({ status: "New" })
    await make().deletePayment({ data: sessionData } as any)
    const retire = calls.find((c) => c.method === "POST" && c.url.endsWith("/invoices/INV1/status"))
    expect(retire?.body).toEqual({ status: "Invalid" })
  })

  it("an invoice with payment activity is NEVER retired", async () => {
    for (const over of [{ status: "Processing" }, { status: "Settled" }, { status: "New", additionalStatus: "PaidPartial" }]) {
      calls = []
      invoice = inv(over)
      await make().deletePayment({ data: sessionData } as any)
      expect(calls.some((c) => c.method === "POST")).toBe(false)
    }
  })

  it("a total change makes a new invoice and retires the old one", async () => {
    invoice = inv({ status: "New" })
    const r = await make().updatePayment({ data: sessionData, amount: 2000, currency_code: "inr", context: {} } as any)
    expect(calls.some((c) => c.method === "POST" && /\/invoices$/.test(c.url))).toBe(true)
    expect(calls.some((c) => c.url.endsWith("/invoices/INV1/status"))).toBe(true)
    expect((r.data as any).amount).toBe("2000.00")
  })

  it("BTCPay down while retiring never blocks the checkout", async () => {
    global.fetch = (async () => new Response("down", { status: 503 })) as any
    await expect(make().deletePayment({ data: sessionData } as any)).resolves.toBeTruthy()
  })

  it("refund: Medusa's raw amount becomes a BTCPay pull payment, and every refund keeps its own claim link", async () => {
    const realFetch2 = global.fetch
    let n = 0
    global.fetch = (async (url: any, init?: any) => {
      calls.push({ method: init?.method || "GET", url: String(url), body: init?.body ? JSON.parse(init.body) : undefined })
      n += 1
      return new Response(JSON.stringify({ id: `PP${n}`, viewLink: `https://btcpay.example.com/pull-payments/PP${n}` }), { status: 200 })
    }) as any
    const first = await make().refundPayment({ data: sessionData, amount: { value: "500", precision: 20 } } as any)
    const second = await make().refundPayment({ data: first.data, amount: { value: "125.5", precision: 20 } } as any)
    global.fetch = realFetch2
    expect(calls[0].url).toBe("https://btcpay.example.com/api/v1/stores/STORE_OURS/invoices/INV1/refund")
    expect(calls[0].body).toMatchObject({ refundVariant: "Custom", customAmount: "500.00", customCurrency: "INR" })
    const refunds = (second.data as any).btcpay_refunds
    expect(refunds.map((r: any) => [r.pull_payment_id, r.amount])).toEqual([["PP1", "500.00"], ["PP2", "125.50"]])
    expect(refunds[1].link).toBe("https://btcpay.example.com/pull-payments/PP2")
  })

  it("webhook: signed InvoiceSettled → captured for the session in the INVOICE's metadata", async () => {
    const raw = JSON.stringify({ type: "InvoiceSettled", storeId: "STORE_OURS", invoiceId: "INV1" })
    const sig = "sha256=" + crypto.createHmac("sha256", storeWebhookSecret("master", "STORE_OURS")).update(raw).digest("hex")
    const r = await make().getWebhookActionAndData({ data: JSON.parse(raw), rawData: raw, headers: { "btcpay-sig": sig } })
    expect(r).toEqual({ action: "captured", data: { session_id: "payses_1", amount: 1950 } })
  })

  it("webhook: OUR store's hand-made webhook signs with the master secret itself → accepted", async () => {
    const raw = JSON.stringify({ type: "InvoiceSettled", storeId: "STORE_OURS", invoiceId: "INV1" })
    const sig = "sha256=" + crypto.createHmac("sha256", "master").update(raw).digest("hex")
    const r = await make().getWebhookActionAndData({ data: JSON.parse(raw), rawData: raw, headers: { "btcpay-sig": sig } })
    expect(r.action).toBe("captured")
  })

  it("webhook: a PARTNER store signed with the master secret is rejected (partners use derived secrets)", async () => {
    const raw = JSON.stringify({ type: "InvoiceSettled", storeId: "STORE_PARTNER", invoiceId: "INV1" })
    const sig = "sha256=" + crypto.createHmac("sha256", "master").update(raw).digest("hex")
    const r = await make().getWebhookActionAndData({ data: JSON.parse(raw), rawData: raw, headers: { "btcpay-sig": sig } })
    expect(r.action).toBe("not_supported")
  })

  it("webhook: unsigned or wrongly signed → not_supported, invoice never fetched", async () => {
    const raw = JSON.stringify({ type: "InvoiceSettled", storeId: "STORE_OURS", invoiceId: "INV1" })
    const r = await make().getWebhookActionAndData({ data: JSON.parse(raw), rawData: raw, headers: { "btcpay-sig": "sha256=00" } })
    expect(r.action).toBe("not_supported")
    expect(calls).toHaveLength(0)
  })
})

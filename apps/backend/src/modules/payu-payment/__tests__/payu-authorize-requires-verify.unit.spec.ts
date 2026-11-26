import crypto from "crypto"

import PayUPaymentProviderService from "../service"

/**
 * #2574 open question → a money hole. A PayU payment may only count as paid when
 * PayU's own verify_payment says so. Before this, `authorizePayment` also took
 * the buyer-supplied `mihpayid` (written into the session by the public
 * POST /store/payu/complete) as proof, so a made-up id placed an unpaid order;
 * and the webhook accepted a payload with NO hash as captured.
 */

const KEY = "testkey"
const SALT = "testsalt"

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any

function provider() {
  return new PayUPaymentProviderService({ logger } as any, {
    merchant_key: KEY,
    merchant_salt: SALT,
    mode: "test",
    auto_capture: true,
  })
}

/** PayU verify_payment reply for one txnid. */
function verifyReply(txnid: string, details: Record<string, unknown> | null) {
  return {
    json: async () =>
      details
        ? { status: 1, msg: "1 out of 1 Transactions Fetched Successfully", transaction_details: { [txnid]: details } }
        : { status: 0, msg: "0 out of 1 Transactions Fetched Successfully", transaction_details: {} },
  }
}

const session = (extra: Record<string, unknown> = {}) => ({
  txnid: "txn_1",
  amount: "1050.00",
  udf1: "payses_1",
  status: "pending",
  ...extra,
})

describe("PayU authorizePayment only trusts PayU's verify_payment", () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it("does NOT authorize a buyer-supplied mihpayid that PayU has never seen", async () => {
    global.fetch = jest.fn().mockResolvedValue(verifyReply("txn_1", null)) as any
    const out = await provider().authorizePayment({
      data: session({ payu_status: "success", status: "success", mihpayid: "made-up-123" }),
    } as any)
    expect(out.status).not.toBe("authorized")
    expect(out.status).not.toBe("captured")
  })

  it("does NOT authorize when the verify call itself fails (stays pending for a retry)", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNRESET")) as any
    const out = await provider().authorizePayment({
      data: session({ payu_status: "success", mihpayid: "made-up-123" }),
    } as any)
    expect(out.status).toBe("pending")
  })

  it("does NOT authorize when PayU verified a smaller amount than the session", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(verifyReply("txn_1", { status: "success", mihpayid: "403993715", amt: "1.00" })) as any
    const out = await provider().authorizePayment({ data: session({ payu_status: "success" }) } as any)
    expect(out.status).not.toBe("captured")
    expect(out.status).not.toBe("authorized")
  })

  it("authorizes when PayU verifies success for the full amount, with PayU's mihpayid", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(verifyReply("txn_1", { status: "success", mihpayid: "403993715", amt: "1050.00" })) as any
    const out = await provider().authorizePayment({
      data: session({ payu_status: "success", mihpayid: "made-up-123" }),
    } as any)
    expect(out.status).toBe("captured")
    expect(out.data?.mihpayid).toBe("403993715")
  })

  it("authorizes a UPI intent payment PayU verified even if the redirect never wrote a status", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(verifyReply("txn_1", { status: "success", mihpayid: "403993716", amt: "1050.00" })) as any
    const out = await provider().authorizePayment({ data: session() } as any)
    expect(out.status).toBe("captured")
  })
})

describe("PayU getWebhookActionAndData", () => {
  const reverseHash = (d: Record<string, string>, salt = SALT) =>
    crypto
      .createHash("sha512")
      .update(
        `${salt}|${d.status}||||||${d.udf5 || ""}|${d.udf4 || ""}|${d.udf3 || ""}|${d.udf2 || ""}|${d.udf1 || ""}|${d.email || ""}|${d.firstname || ""}|${d.productinfo || ""}|${d.amount || ""}|${d.txnid}|${KEY}`
      )
      .digest("hex")

  const base = {
    status: "success",
    txnid: "txn_1",
    udf1: "payses_1",
    amount: "1050.00",
    email: "a@b.c",
    firstname: "A",
    productinfo: "Order txn_1",
  }

  const call = (data: Record<string, unknown>) =>
    provider().getWebhookActionAndData({ data, rawData: "", headers: {} } as any)

  it("rejects a success payload with NO hash", async () => {
    expect((await call(base)).action).toBe("not_supported")
  })

  it("rejects a success payload with a wrong hash", async () => {
    expect((await call({ ...base, hash: "deadbeef" })).action).toBe("not_supported")
  })

  it("accepts a correctly signed payload and points at the payment SESSION (udf1), not the txnid", async () => {
    const out = await call({ ...base, hash: reverseHash(base) })
    expect(out.action).toBe("captured")
    expect(out.data?.session_id).toBe("payses_1")
  })

  it("accepts PayU's additionalCharges reverse-hash variant", async () => {
    const withCharges = { ...base, additionalCharges: "21.00" }
    const hash = crypto
      .createHash("sha512")
      .update(`21.00|${SALT}|success||||||||||payses_1|a@b.c|A|Order txn_1|1050.00|txn_1|${KEY}`)
      .digest("hex")
    const out = await call({ ...withCharges, hash })
    expect(out.action).toBe("captured")
  })
})

describe("PayU authorizePayment — a paid LINK completes through a proven txnid", () => {
  const realFetch = global.fetch
  const realSecret = process.env.COOKIE_SECRET
  beforeAll(() => {
    process.env.COOKIE_SECRET = "test-cookie-secret-123"
  })
  afterAll(() => {
    process.env.COOKIE_SECRET = realSecret
  })
  afterEach(() => {
    global.fetch = realFetch
  })

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mintPayuExternalProof, stripReservedPayuSessionKeys } = require("../../../lib/payments/payu-external-proof")

  it("verifies the LINK's txnid, not the fresh one initiatePayment wrote", async () => {
    const fetchMock = jest.fn().mockImplementation(async (_url: string, init: any) => {
      const var1 = new URLSearchParams(init.body).get("var1")
      return var1 === "link_txn_9"
        ? verifyReply("link_txn_9", { status: "success", mihpayid: "999", amt: "1050.00" })
        : verifyReply(String(var1), null)
    })
    global.fetch = fetchMock as any
    const out = await provider().authorizePayment({
      // What Medusa stores: caller data UNDER provider data → txnid is fresh.
      data: session({ txnid: "fresh_txn", payu_status: "success", mihpayid: "999", ...mintPayuExternalProof("link_txn_9") }),
    } as any)
    expect(out.status).toBe("captured")
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get("var1")).toBe("link_txn_9")
  })

  it("ignores a txnid whose proof is forged", async () => {
    const fetchMock = jest.fn().mockImplementation(async (_url: string, init: any) => {
      const var1 = new URLSearchParams(init.body).get("var1")
      return var1 === "someone_elses_paid_txn"
        ? verifyReply(String(var1), { status: "success", mihpayid: "1", amt: "1050.00" })
        : verifyReply(String(var1), null)
    })
    global.fetch = fetchMock as any
    const out = await provider().authorizePayment({
      data: session({ payu_external_txnid: "someone_elses_paid_txn", payu_external_proof: "f".repeat(64) }),
    } as any)
    expect(out.status).toBe("pending")
  })

  it("a store caller cannot inject status, ids, proof or a merchant account", () => {
    const out = stripReservedPayuSessionKeys({
      payu_status: "success",
      mihpayid: "1",
      txnid: "t",
      partner_merchant_key: "mine",
      partner_merchant_salt: "mine",
      payu_external_txnid: "x",
      payu_external_proof: "y",
      setup_future_usage: "off_session",
    })
    expect(out).toEqual({ setup_future_usage: "off_session" })
  })
})

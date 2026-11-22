import { createHash } from "crypto"

import {
  getPayuRefunds,
  interpretActionStatus,
  interpretRefundResponse,
  newRefundToken,
  PAYU_REFUND_TOKEN_MAX,
  refundPayuPayment,
} from "../payu-refund"

const sha = (s: string) => createHash("sha512").update(s).digest("hex")
const creds = { key: "KEY", salt: "SALT", mode: "live" }
const fetchJson = (json: any) => jest.fn(async () => ({ json: async () => json })) as any

// Verbatim from live PayU on 2026-11-22 (order #158 refund).
const LIVE_QUEUED = { msg: "Refund Request Queued", status: 1, error_code: 102, mihpayid: 31958845963, request_id: "23751758654" }
const LIVE_ACTIONS = {
  status: 1,
  msg: "1 out of 1 Transactions Fetched Successfully",
  transaction_details: {
    "31958845963": {
      "23750515142": { request_id: "23750515142", amt: "1.05", action: "capture", token: "", status: "SUCCESS", refund_mode: "-" },
      "23751758654": {
        request_id: "23751758654", bank_ref_num: "632614637764", amt: "1.05", action: "refund",
        token: "jytrefund1581795337323", status: "pending", bank_arn: null, refund_mode: "Instant Credit through UPI",
      },
    },
  },
}

describe("PayU refunds (#2580)", () => {
  it("treats the live 'Refund Request Queued' (code 102) as accepted", () => {
    expect(interpretRefundResponse(LIVE_QUEUED)).toEqual({
      accepted: true, request_id: "23751758654", error_code: 102, message: "Refund Request Queued", check_tomorrow: false,
    })
  })

  it("names documented failures in plain words", () => {
    expect(interpretRefundResponse({ status: 0, error_code: 106, msg: "token already used" })).toMatchObject({
      accepted: false, message: "That refund token was already used",
    })
    expect(interpretRefundResponse({ status: 1, msg: "Refund request failed" }).accepted).toBe(false)
    expect(interpretRefundResponse({ status: 0, msg: "transaction not exists" })).toMatchObject({ accepted: false, message: "transaction not exists" })
  })

  it("a same-day capture is queued but 'check tomorrow', not a failure", () => {
    expect(interpretRefundResponse({ status: 1, error_code: 226, msg: "Capture is done today, please check for refund status tomorrow", request_id: "9" }))
      .toMatchObject({ accepted: true, check_tomorrow: true, request_id: "9" })
  })

  it("sends cancel_refund_transaction signed sha512(key|command|mihpayid|salt) to info.payu.in", async () => {
    const f = fetchJson(LIVE_QUEUED)
    const out = await refundPayuPayment(creds, { mihpayid: "31958845963", amount: 1.05, token: "tok1" }, f)
    expect(out.accepted).toBe(true)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe("https://info.payu.in/merchant/postservice.php?form=2")
    const sent = new URLSearchParams(init.body)
    expect(sent.get("command")).toBe("cancel_refund_transaction")
    expect(sent.get("var1")).toBe("31958845963")
    expect(sent.get("var2")).toBe("tok1")
    expect(sent.get("var3")).toBe("1.05")
    expect(sent.get("hash")).toBe(sha("KEY|cancel_refund_transaction|31958845963|SALT"))
  })

  it("never sends a token longer than PayU's 23 characters, nor a non-positive amount", async () => {
    expect(newRefundToken("refund_order_158_").length).toBeLessThanOrEqual(PAYU_REFUND_TOKEN_MAX)
    const f = fetchJson(LIVE_QUEUED)
    await refundPayuPayment(creds, { mihpayid: "1", amount: 1, token: "x".repeat(40) }, f)
    expect(new URLSearchParams(f.mock.calls[0][1].body).get("var2")!.length).toBe(23)
    const g = fetchJson(LIVE_QUEUED)
    expect((await refundPayuPayment(creds, { mihpayid: "1", amount: 0 }, g)).accepted).toBe(false)
    expect(g).not.toHaveBeenCalled()
  })

  it("strips remark characters PayU would silently drop", async () => {
    const f = fetchJson(LIVE_QUEUED)
    await refundPayuPayment(creds, { mihpayid: "1", amount: 1, token: "t", remarks: "Order #158: test & cancel" }, f)
    const var9 = JSON.parse(new URLSearchParams(f.mock.calls[0][1].body).get("var9")!)
    expect(var9.refundDetails.remarks).not.toMatch(/[#:&]/)
  })

  it("reads refunds (not the capture) out of the live check_action_status answer", () => {
    expect(interpretActionStatus(LIVE_ACTIONS, "31958845963")).toEqual([
      {
        request_id: "23751758654", token: "jytrefund1581795337323", amount: 1.05, status: "pending",
        refund_mode: "Instant Credit through UPI", bank_ref_num: "632614637764", bank_arn: null,
      },
    ])
  })

  it("🔴 asks check_action_status with var2=payuid (without it PayU says 'Invalid command name')", async () => {
    const f = fetchJson(LIVE_ACTIONS)
    const refunds = await getPayuRefunds(creds, "31958845963", f)
    expect(refunds).toHaveLength(1)
    const sent = new URLSearchParams(f.mock.calls[0][1].body)
    expect(sent.get("command")).toBe("check_action_status")
    expect(sent.get("var2")).toBe("payuid")
  })

  it("an error answer yields no refunds rather than throwing", () => {
    expect(interpretActionStatus({ status: 0, msg: "Invalid command name" }, "1")).toEqual([])
  })
})

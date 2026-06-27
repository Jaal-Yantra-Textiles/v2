import { createHash } from "crypto"
import {
  buildVerifyPaymentHash,
  interpretVerifyPayment,
  payuInfoUrl,
} from "../verify-payment"

const sha = (s: string) => createHash("sha512").update(s).digest("hex")

describe("buildVerifyPaymentHash", () => {
  it("hashes sha512(key|verify_payment|txnid|salt)", () => {
    const h = buildVerifyPaymentHash("Shrwii", "SALT", "918188")
    expect(h).toBe(sha("Shrwii|verify_payment|918188|SALT"))
  })
})

describe("payuInfoUrl", () => {
  it("selects test by default and info.payu.in for live/prod", () => {
    expect(payuInfoUrl()).toBe("https://test.payu.in/merchant/postservice.php?form=2")
    expect(payuInfoUrl("test")).toMatch(/test\.payu\.in/)
    expect(payuInfoUrl("live")).toBe("https://info.payu.in/merchant/postservice.php?form=2")
    expect(payuInfoUrl("prod")).toMatch(/info\.payu\.in/)
  })
})

describe("interpretVerifyPayment", () => {
  const ok = (amount: string) => ({
    status: 1,
    transaction_details: { "918188": { status: "success", transaction_amount: amount, amt: amount } },
  })

  it("is paid on success when the settled amount covers minAmount", () => {
    const r = interpretVerifyPayment(ok("1.00"), "918188", 1)
    expect(r.paid).toBe(true)
    expect(r.amount).toBe(1)
    expect(r.status).toBe("success")
  })

  it("is paid with no minAmount constraint", () => {
    expect(interpretVerifyPayment(ok("5.00"), "918188").paid).toBe(true)
  })

  it("is NOT paid when the settled amount is short of minAmount", () => {
    expect(interpretVerifyPayment(ok("1.00"), "918188", 50).paid).toBe(false)
  })

  it("is NOT paid when the txn status is not success", () => {
    const j = { status: 1, transaction_details: { "918188": { status: "failure", amt: "1.00" } } }
    expect(interpretVerifyPayment(j, "918188").paid).toBe(false)
  })

  it("is NOT paid when the API call failed or txn is missing", () => {
    expect(interpretVerifyPayment({ status: 0, msg: "Invalid Hash." }, "918188").paid).toBe(false)
    expect(interpretVerifyPayment({ status: 1, transaction_details: {} }, "918188").paid).toBe(false)
  })

  it("tolerates 1-paisa float noise on the amount check", () => {
    expect(interpretVerifyPayment(ok("0.9999"), "918188", 1).paid).toBe(true)
  })
})

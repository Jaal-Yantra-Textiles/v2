/**
 * Classic PayU `verify_payment` re-verification for the payment-link webhook.
 *
 * PayU signs payment-link webhooks with the merchant's Salt Version 2 (a 256-bit
 * RSA scheme that PayU does not publish a verification method for), so we cannot
 * reproduce the inbound `hash` locally. Instead we authenticate the webhook the
 * robust, replay-proof way: independently re-query PayU for the transaction and
 * trust *that* — never the inbound payload alone.
 *
 * `verify_payment` only needs the classic key + salt (Salt v1) + txnid, all of
 * which we have, and it returns the authoritative status + settled amount.
 * Endpoint + hash mirror the payu-payment provider's verifyPaymentWithOpts.
 */
import { createHash } from "crypto"

const sha512Hex = (s: string) => createHash("sha512").update(s).digest("hex")

/** Reverse SHA512 command hash: sha512(key|command|var1|salt). */
export function buildVerifyPaymentHash(
  key: string,
  salt: string,
  txnid: string,
  hasher: (s: string) => string = sha512Hex
): string {
  return hasher([key, "verify_payment", txnid, salt].join("|"))
}

/** Classic info endpoint — info.payu.in for live, test.payu.in otherwise. `form=2` ⇒ JSON. */
export function payuInfoUrl(mode?: string): string {
  const m = (mode || "test").toLowerCase()
  const live = m === "live" || m === "prod" || m === "production"
  const host = live ? "https://info.payu.in" : "https://test.payu.in"
  return `${host}/merchant/postservice.php?form=2`
}

export type VerifyResult = {
  paid: boolean
  status: string | null
  amount: number | null
  raw: any
}

/**
 * Interpret a `verify_payment` JSON response for one txnid. Paid iff the API call
 * succeeded (status:1), the txn status is success, and — when `minAmount` is
 * given — the settled amount covers it (1-paisa tolerance for float noise).
 */
export function interpretVerifyPayment(
  json: any,
  txnid: string,
  minAmount?: number
): VerifyResult {
  const t = json?.transaction_details?.[txnid]
  if (json?.status !== 1 || !t) {
    return { paid: false, status: null, amount: null, raw: json }
  }
  const status = String(t.status || "").toLowerCase()
  const amount = Number(t.transaction_amount ?? t.amt)
  const enough =
    minAmount === undefined || (!isNaN(amount) && amount + 0.001 >= minAmount)
  return {
    paid: status === "success" && enough,
    status,
    amount: isNaN(amount) ? null : amount,
    raw: t,
  }
}

export type VerifyPaymentOpts = {
  key: string
  salt: string
  mode?: string
  txnid: string
  minAmount?: number
}

/** Call PayU `verify_payment` and return whether the txn is genuinely paid. */
export async function verifyPayuTransaction(
  opts: VerifyPaymentOpts,
  fetchImpl: typeof fetch = fetch
): Promise<VerifyResult> {
  const hash = buildVerifyPaymentHash(opts.key, opts.salt, opts.txnid)
  const res = await fetchImpl(payuInfoUrl(opts.mode), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      key: opts.key,
      command: "verify_payment",
      hash,
      var1: opts.txnid,
    }).toString(),
  })
  const json: any = await res.json().catch(() => ({}))
  return interpretVerifyPayment(json, opts.txnid, opts.minAmount)
}

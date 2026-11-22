import { createHash } from "crypto"

import { parseUpiIntentResponse } from "../../api/store/payu/intent/lib"

/**
 * A UPI payment request (an "intent") for a design-order cart, minted through
 * PayU's classic server-to-server `_payment` flow (#2572).
 *
 * ## Why this exists next to the payment link
 *
 * The design-order email carried a QR of the PayU payment-link URL. A phone
 * camera opens it, but a UPI app does not — it expects `upi://pay?…`, not a web
 * page. This mints the real thing: PayU answers with `intentURIData`
 * (`pa=…&am=…&tr=…`), which with `upi://pay?` in front is a QR that GPay,
 * PhonePe, Paytm or BHIM pays directly.
 *
 * Proven live on 2026-11-22: a ₹1 intent minted with the prod key/salt was
 * scanned and paid, and PayU's dashboard webhook hit `/webhooks/payu/link`.
 *
 * ## 🔴 An intent cannot be switched off
 *
 * A payment link can be deactivated at PayU; an intent cannot, and PayU states
 * no lifetime for it. A buyer holding an old QR (a screenshot, a cached email
 * image) can still pay it after a reprice. So the defence is not here — it is
 * in the webhook, which re-verifies the amount against what is due NOW and
 * records any payment it cannot apply (`process-link-webhook.ts`).
 *
 * ## `udf1` is the cart id
 *
 * The same contract as the payment link: the webhook completes the cart named
 * in `udf1`, after independently re-querying PayU. Nothing new to wire.
 */

export type MintedUpiIntent = {
  /** Our PayU txnid — what `verify_payment` is asked about. */
  txnid: string
  /** `upi://pay?pa=…&am=…` — what the QR encodes. */
  uri: string
  /** What the intent asks for, in major units (₹). */
  amount: number
  /** PayU's id for the pending payment (mihpayid once paid). */
  payment_id: string | null
  /** ISO instant. */
  created_at: string
}

export type MintUpiIntentResult =
  | { ok: true; intent: MintedUpiIntent }
  | { ok: false; error: string }

const sha512Hex = (s: string) => createHash("sha512").update(s).digest("hex")

const isLive = (mode?: string) => {
  const m = String(mode || "test").toLowerCase()
  return m === "live" || m === "prod" || m === "production"
}

export const payuPaymentUrl = (mode?: string): string =>
  isLive(mode) ? "https://secure.payu.in/_payment" : "https://test.payu.in/_payment"

/**
 * PayU txnids top out around 25 characters, and a cart id (`cart_01…`) is 31,
 * so the cart travels in `udf1` and the txnid is our own short one.
 */
export const newUpiTxnId = (now: Date = new Date()): string =>
  `upi${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** `1100` → `"1100.00"`. The hash covers this exact string, so it is built once. */
export const formatPayuAmount = (amount: number): string => amount.toFixed(2)

/**
 * The form PayU's `_payment` takes for a server-to-server UPI intent, signed
 * with the classic request hash:
 * `sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)`.
 */
export const buildUpiIntentRequest = (input: {
  key: string
  salt: string
  txnid: string
  amount: string
  cartId: string
  email: string
  firstname: string
  phone: string
  productinfo: string
  clientIp?: string
  hasher?: (s: string) => string
}): Record<string, string> => {
  const hasher = input.hasher ?? sha512Hex
  const udf1 = input.cartId
  const hash = hasher(
    [
      input.key,
      input.txnid,
      input.amount,
      input.productinfo,
      input.firstname,
      input.email,
      udf1,
      "", // udf2
      "", // udf3
      "", // udf4
      "", // udf5
      "",
      "",
      "",
      "",
      "",
      input.salt,
    ].join("|")
  )
  return {
    key: input.key,
    txnid: input.txnid,
    amount: input.amount,
    productinfo: input.productinfo,
    firstname: input.firstname,
    email: input.email,
    phone: input.phone,
    udf1,
    // PayU requires return URLs even though nothing is redirected in S2S.
    surl: "https://jaalyantra.com/",
    furl: "https://jaalyantra.com/",
    hash,
    pg: "UPI",
    bankcode: "INTENT",
    txn_s2s_flow: "4",
    // No buyer is present when the email is minted; PayU only needs a value.
    s2s_client_ip: input.clientIp || "127.0.0.1",
    s2s_device_info: "JaalYantra-design-order-email",
  }
}

/** A digits-only 10-digit Indian mobile, or null. */
const tenDigitPhone = (raw: unknown): string | null => {
  const d = String(raw ?? "").replace(/\D/g, "")
  const last10 = d.length >= 10 ? d.slice(-10) : ""
  return /^[6-9]\d{9}$/.test(last10) ? last10 : null
}

/**
 * Mint one UPI intent. Never throws: a missing QR must not cost the caller the
 * payment link it already has, so every failure is a returned reason.
 */
export const mintPayuUpiIntent = async (
  input: {
    cartId: string
    amount: number
    email?: string | null
    firstName?: string | null
    phone?: string | null
    now?: Date
  },
  deps: {
    env?: Record<string, string | undefined>
    fetchImpl?: typeof fetch
    timeoutMs?: number
  } = {}
): Promise<MintUpiIntentResult> => {
  const env = deps.env ?? process.env
  const key = env.PAYU_MERCHANT_KEY
  const salt = env.PAYU_MERCHANT_SALT
  if (!key || !salt) return { ok: false, error: "PayU key/salt not configured" }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: "amount is not a positive number" }
  }

  const now = input.now ?? new Date()
  const txnid = newUpiTxnId(now)
  const amount = formatPayuAmount(input.amount)
  const form = buildUpiIntentRequest({
    key,
    salt,
    txnid,
    amount,
    cartId: input.cartId,
    email: String(input.email || "").trim() || "orders@jaalyantra.com",
    firstname: String(input.firstName || "").trim() || "Buyer",
    phone: tenDigitPhone(input.phone) ?? "9999999999",
    productinfo: `Order ${input.cartId}`,
  })

  const fetchImpl = deps.fetchImpl ?? fetch
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 20_000)
  try {
    const res = await fetchImpl(payuPaymentUrl(env.PAYU_MODE), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(form).toString(),
      signal: ctrl.signal,
    })
    const text = await res.text()
    let json: any
    try {
      json = JSON.parse(text)
    } catch {
      // PayU answers with its hosted HTML page when S2S intent is not enabled.
      return { ok: false, error: `PayU did not return JSON (HTTP ${res.status})` }
    }
    const parsed = parseUpiIntentResponse(json)
    const status = String(parsed.txn_status ?? "").toLowerCase()
    if (!parsed.upi_link || (status && status !== "pending")) {
      const why =
        json?.metaData?.message || json?.error || json?.metaData?.statusCode || status || "no intent"
      return { ok: false, error: `PayU did not return a UPI intent: ${why}` }
    }
    return {
      ok: true,
      intent: {
        txnid,
        // PayU sends `pn=JAAL YANTRA …` with raw spaces. The QR paid live on
        // 2026-11-22 carried them as %20, so that is the form we encode.
        uri: parsed.upi_link.replace(/ /g, "%20"),
        amount: Number(amount),
        payment_id: parsed.payment_id,
        created_at: now.toISOString(),
      },
    }
  } catch (e: any) {
    return {
      ok: false,
      error: e?.name === "AbortError" ? "PayU did not answer in time" : e?.message ?? String(e),
    }
  } finally {
    clearTimeout(timer)
  }
}

/** True only for a QR payload a UPI app can pay. */
export const isUpiIntentUri = (s: unknown): s is string =>
  typeof s === "string" && /^upi:\/\/pay\?/i.test(s) && /[?&]am=/.test(s) && /[?&]pa=/.test(s)

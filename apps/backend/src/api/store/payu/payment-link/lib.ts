/**
 * Pure helpers for the PayU OneAPI "Payment Link" route (Rail B).
 *
 * OneAPI is OAuth-based: mint a bearer token from accounts.payu.in, then POST to
 * oneapi.payu.in/payment-links with a `merchantId` header. The response carries a
 * shareable `https://v.payu.in/…` link whose checkout offers UPI + cards.
 */

export const ONEAPI_HOSTS = {
  test: {
    token: "https://uat-accounts.payu.in/oauth/token",
    links: "https://uatoneapi.payu.in/payment-links",
  },
  prod: {
    token: "https://accounts.payu.in/oauth/token",
    links: "https://oneapi.payu.in/payment-links",
  },
} as const

/** Pick UAT vs production hosts. Anything but live/prod → test (UAT). */
export function oneapiHosts(mode?: string) {
  const m = (mode || "test").toLowerCase()
  return m === "live" || m === "prod" || m === "production"
    ? ONEAPI_HOSTS.prod
    : ONEAPI_HOSTS.test
}

export type PaymentLinkInput = {
  /** Amount in INR (major units). Coerced to an integer ≥ 1 (PayU subAmount). */
  amount: number | string
  description?: string
  invoiceNumber?: string
  isPartialPaymentAllowed?: boolean
  successURL?: string
  failureURL?: string
  expiryDate?: string
  customer?: { name?: string; email?: string; mobileNumber?: string }
  /** Cart this link pays for — stored as udf1 so the webhook can map back. */
  cartId?: string
}

/**
 * Build the OneAPI create-payment-link JSON body. Enforces PayU's constraints:
 * integer `subAmount` ≥ 1 and `invoiceNumber` ≤ 16 chars.
 */
export function buildPaymentLinkBody(input: PaymentLinkInput): Record<string, any> {
  const subAmount = Math.max(1, Math.round(Number(input.amount) || 0))
  const body: Record<string, any> = {
    description: input.description || "Payment",
    source: "API",
    subAmount,
    isPartialPaymentAllowed: !!input.isPartialPaymentAllowed,
  }
  if (input.invoiceNumber) {
    body.invoiceNumber = String(input.invoiceNumber).slice(0, 16)
  }
  const c = input.customer
  if (c && (c.name || c.email || c.mobileNumber)) {
    body.customer = { name: c.name, email: c.email, mobileNumber: c.mobileNumber }
  }
  if (input.successURL) body.successURL = input.successURL
  if (input.failureURL) body.failureURL = input.failureURL
  if (input.expiryDate) body.expiryDate = input.expiryDate
  // Carry the cart id in udf1 so the dashboard webhook can map the payment back.
  if (input.cartId) {
    body.udf = { udf1: input.cartId, udf2: null, udf3: null, udf4: null, udf5: null }
  }
  return body
}

export type ParsedPaymentLink = {
  payment_link: string | null
  invoice_number: string | null
  total_amount: number | null
  active: boolean | null
  status: number | null
  message: string | null
}

/** Normalize the OneAPI create-payment-link response. */
export function parsePaymentLinkResponse(json: any): ParsedPaymentLink {
  const r = json?.result ?? {}
  return {
    payment_link: r.paymentLink ?? null,
    invoice_number: r.invoiceNumber ?? null,
    total_amount: r.totalAmount ?? null,
    active: typeof r.active === "boolean" ? r.active : null,
    status: typeof json?.status === "number" ? json.status : null,
    message: json?.message ?? null,
  }
}

// ── Verify-then-complete helpers (webhook → order) ──────────────────────

/**
 * Verify a PayU dashboard webhook's reverse-SHA512 hash with the merchant salt.
 * Formula (docs.payu.in/docs/webhook-events-and-sample-payloads):
 *   sha512([additionalCharges|]salt|status||||||udf5|udf4|udf3|udf2|udf1|
 *           email|firstname|productinfo|amount|txnid|key)
 */
export function verifyWebhookHash(
  payload: Record<string, any>,
  salt: string,
  sha512Hex: (s: string) => string
): boolean {
  if (!payload?.hash || !salt) return false
  const ac = payload.additionalCharges || ""
  const tail = [
    payload.status ?? "",
    "",
    "",
    "",
    "",
    "",
    payload.udf5 ?? "",
    payload.udf4 ?? "",
    payload.udf3 ?? "",
    payload.udf2 ?? "",
    payload.udf1 ?? "",
    payload.email ?? "",
    payload.firstname ?? "",
    payload.productinfo ?? "",
    payload.amount ?? "",
    payload.txnid ?? "",
    payload.key ?? "",
  ]
  const signing = (ac ? [ac, salt, ...tail] : [salt, ...tail]).join("|")
  return sha512Hex(signing).toLowerCase() === String(payload.hash).toLowerCase()
}

export type LinkPaidResult = {
  paid: boolean
  settled_amount: number | null
  transaction_id: string | null
  mode: string | null
}

/**
 * Decide whether a payment-link is paid from its /txns response, optionally
 * requiring the settled amount to cover `minAmount` (INR).
 */
export function isLinkPaid(txnsJson: any, minAmount?: number): LinkPaidResult {
  const rows: any[] = txnsJson?.result?.data || []
  const ok = rows.find((t) => String(t?.status || "").toLowerCase() === "success")
  if (!ok) {
    return { paid: false, settled_amount: null, transaction_id: null, mode: null }
  }
  const settled = Number(ok.settledAmount)
  const enough = minAmount === undefined || (!isNaN(settled) && settled >= minAmount)
  return {
    paid: enough,
    settled_amount: isNaN(settled) ? null : settled,
    transaction_id: ok.transactionId ?? null,
    mode: ok.mode ?? null,
  }
}

export function oneapiLinkTxnsUrl(mode: string | undefined, invoiceNumber: string): string {
  const base = oneapiHosts(mode).links
  const q = `?dateFrom=2020-01-01&dateTo=2099-12-31`
  return `${base}/${encodeURIComponent(invoiceNumber)}/txns${q}`
}

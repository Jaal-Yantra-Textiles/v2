/**
 * Pure helpers for the PayU UPI-Intent route.
 *
 * A PayU payment session (created by initiatePayment in the payu-payment
 * provider) already carries the signed hosted-checkout fields:
 *   { key, txnid, amount, productinfo, firstname, email, phone, udf1, hash,
 *     payment_url }
 * The S2S UPI-Intent call reuses those exact fields (same SHA-512 hash) and
 * just adds the UPI-intent switches, so we never need the salt here — we replay
 * the already-signed session data to `payment_url` with `bankcode=INTENT`.
 */

export type PayuSessionData = {
  key?: string
  txnid?: string
  amount?: string
  productinfo?: string
  firstname?: string
  email?: string
  phone?: string
  udf1?: string
  hash?: string
  payment_url?: string
  [k: string]: unknown
}

export type UpiIntentFormOpts = {
  surl: string
  furl: string
  clientIp?: string
  deviceInfo?: string
  /** UPI app hint: phonepe | googlepay | paytm | genericintent (default). */
  upiAppName?: string
}

/**
 * Build the application/x-www-form-urlencoded field map for the S2S UPI-Intent
 * call. Reuses the session's signed fields verbatim (the hash already covers
 * key|txnid|amount|productinfo|firstname|email|udf1|…|salt).
 */
export function buildUpiIntentForm(
  d: PayuSessionData,
  opts: UpiIntentFormOpts
): Record<string, string> {
  return {
    key: d.key ?? "",
    txnid: d.txnid ?? "",
    amount: d.amount ?? "",
    productinfo: d.productinfo ?? "",
    firstname: d.firstname ?? "",
    email: d.email ?? "",
    phone: d.phone ?? "",
    udf1: d.udf1 ?? "",
    surl: opts.surl,
    furl: opts.furl,
    hash: d.hash ?? "",
    pg: "UPI",
    bankcode: "INTENT",
    txn_s2s_flow: "4",
    s2s_client_ip: opts.clientIp || "127.0.0.1",
    s2s_device_info: opts.deviceInfo || "Mozilla/5.0",
    ...(opts.upiAppName ? { upiAppName: opts.upiAppName } : {}),
  }
}

export type ParsedUpiIntent = {
  upi_link: string | null
  qr_url: string | null
  payment_id: string | null
  txn_status: string | null
}

/** Normalize PayU's S2S `/_payment` UPI-intent response into a UPI deep link. */
export function parseUpiIntentResponse(json: any): ParsedUpiIntent {
  const result = json?.result ?? {}
  const raw: string | undefined =
    result.intentURIData ?? result.intentUri ?? result.intentId
  const upi_link = raw
    ? raw.startsWith("upi://")
      ? raw
      : `upi://pay?${raw}`
    : null
  return {
    upi_link,
    qr_url: result.intentUrlWithQR ?? null,
    payment_id: result.paymentId ?? null,
    txn_status: json?.metaData?.txnStatus ?? json?.status ?? null,
  }
}

/** Find the PayU payment session on a cart's payment collection. */
export function findPayuSession(cart: any): any | null {
  const sessions = cart?.payment_collection?.payment_sessions || []
  return (
    sessions.find((s: any) => String(s?.provider_id || "").includes("payu")) ||
    null
  )
}

/** Build success/failure return URLs from a storefront origin (mirrors storefront). */
export function buildReturnUrls(
  origin: string | null | undefined,
  cartId: string
): { surl: string; furl: string } {
  const base = (origin || "").replace(/\/+$/, "")
  const q = `?cart_id=${encodeURIComponent(cartId)}`
  return {
    surl: `${base}/api/payu/success${q}`,
    furl: `${base}/api/payu/failure${q}`,
  }
}

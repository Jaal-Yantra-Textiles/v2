import {
  buildPaymentLinkBody,
  oneapiHosts,
  parsePaymentLinkResponse,
  type PaymentLinkInput,
} from "../../store/payu/payment-link/lib"

export type CreatedPayuLink = {
  payment_link: string | null
  invoice_number: string | null
  error?: string
}

/**
 * Create a shareable PayU OneAPI payment link (OAuth client-credentials → create
 * link), reusing the store payment-link lib. Used for investor capital calls /
 * subscriptions. Returns `{ payment_link: null, error }` (never throws) when PayU
 * isn't configured or the request fails, so the caller can still create the
 * pending Payment and surface a manual-pay fallback.
 *
 * Pass a stable reference (e.g. the investor Payment id) as `reference` — it goes
 * into udf1 so a future webhook can map the settlement back.
 */
export async function createPayuLink(
  input: PaymentLinkInput & { reference?: string },
  logger?: { error?: (m: string) => void; warn?: (m: string) => void }
): Promise<CreatedPayuLink> {
  const clientId = process.env.PAYU_CLIENT_ID
  const clientSecret = process.env.PAYU_CLIENT_SECRET
  const merchantId = process.env.PAYU_MERCHANT_ID
  if (!clientId || !clientSecret || !merchantId) {
    return { payment_link: null, invoice_number: null, error: "PayU OneAPI not configured" }
  }
  const hosts = oneapiHosts(process.env.PAYU_ONEAPI_MODE)
  if (!input.invoiceNumber) {
    input.invoiceNumber = `inv${String(Date.now()).slice(-13)}`
  }
  if (input.reference) {
    input.cartId = input.reference // → udf1, for webhook mapping
  }

  // 1) OAuth token
  let token: string
  try {
    const tr = await fetch(hosts.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "create_payment_links",
      }).toString(),
    })
    const tj: any = await tr.json().catch(() => ({}))
    if (!tj.access_token) {
      logger?.error?.(`[PayU capital-call] token failed (${tr.status})`)
      return { payment_link: null, invoice_number: null, error: "PayU token request failed" }
    }
    token = tj.access_token
  } catch (e: any) {
    logger?.error?.(`[PayU capital-call] token error: ${e.message}`)
    return { payment_link: null, invoice_number: null, error: e.message }
  }

  // 2) Create link
  try {
    const cr = await fetch(hosts.links, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        merchantId: String(merchantId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildPaymentLinkBody(input)),
    })
    const cj: any = await cr.json().catch(() => ({}))
    const parsed = parsePaymentLinkResponse(cj)
    if (!parsed.payment_link) {
      logger?.warn?.(`[PayU capital-call] no link (${cr.status})`)
      return { payment_link: null, invoice_number: parsed.invoice_number, error: cj?.message || "no link" }
    }
    return { payment_link: parsed.payment_link, invoice_number: parsed.invoice_number }
  } catch (e: any) {
    logger?.error?.(`[PayU capital-call] create error: ${e.message}`)
    return { payment_link: null, invoice_number: null, error: e.message }
  }
}

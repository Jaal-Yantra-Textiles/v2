/**
 * Minimal BTCPay Server Greenfield v1 client — only what checkout needs.
 *
 * Paths: released BTCPay versions serve invoice endpoints under
 * `/api/v1/stores/{storeId}/invoices/{invoiceId}`; the current master spec
 * (2026-11) also lists store-less `/api/v1/invoices/{invoiceId}`. A hosted
 * instance can be on either, so reads and refunds try the store-scoped path
 * first and fall back on 404.
 *
 * API key permissions this client needs (one key, on the account that owns
 * our store AND every partner store):
 *   btcpay.store.cancreateinvoice           POST   …/invoices
 *   btcpay.store.canviewinvoices            GET    …/invoices/{id}
 *   btcpay.store.cancreatepullpayments      POST   …/invoices/{id}/refund
 *   btcpay.store.canmodifyinvoices          POST   …/invoices/{id}/status (retire a replaced invoice)
 *   btcpay.store.webhooks.canmodifywebhooks GET/POST …/webhooks
 * Nothing here moves money: a refund only creates a pull payment the buyer
 * claims with their own address.
 */

export type BtcpayConfig = {
  server_url: string
  api_key: string
}

export type BtcpayInvoice = {
  id: string
  storeId?: string
  status: string // New | Processing | Expired | Invalid | Settled
  additionalStatus?: string // None | PaidLate | PaidPartial | Marked | Invalid | PaidOver
  amount: string // decimal, invoice currency, major units
  currency: string
  checkoutLink?: string
  metadata?: Record<string, any>
}

export type CreateInvoiceInput = {
  amount: string
  currency: string
  metadata: Record<string, any>
  redirectURL?: string
}

export class BtcpayHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const base = (cfg: BtcpayConfig) => cfg.server_url.replace(/\/+$/, "")

async function call<T>(cfg: BtcpayConfig, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base(cfg)}${path}`, {
    method,
    headers: {
      Authorization: `token ${cfg.api_key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    // Never echo the key; BTCPay's error body is safe to surface.
    throw new BtcpayHttpError(res.status, `BTCPay ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`)
  }
  return (text ? JSON.parse(text) : {}) as T
}

/** Store-scoped path first; store-less on 404 (see header). */
async function callInvoice<T>(cfg: BtcpayConfig, method: string, storeId: string, rest: string, body?: unknown): Promise<T> {
  const enc = encodeURIComponent
  try {
    return await call<T>(cfg, method, `/api/v1/stores/${enc(storeId)}/invoices/${rest}`, body)
  } catch (e) {
    if (e instanceof BtcpayHttpError && e.status === 404) {
      return call<T>(cfg, method, `/api/v1/invoices/${rest}`, body)
    }
    throw e
  }
}

export function createInvoice(cfg: BtcpayConfig, storeId: string, input: CreateInvoiceInput): Promise<BtcpayInvoice> {
  return call<BtcpayInvoice>(cfg, "POST", `/api/v1/stores/${encodeURIComponent(storeId)}/invoices`, {
    amount: input.amount,
    currency: input.currency,
    metadata: input.metadata,
    checkout: {
      ...(input.redirectURL ? { redirectURL: input.redirectURL, redirectAutomatically: true } : {}),
    },
  })
}

export function getInvoice(cfg: BtcpayConfig, storeId: string, invoiceId: string): Promise<BtcpayInvoice> {
  return callInvoice<BtcpayInvoice>(cfg, "GET", storeId, encodeURIComponent(invoiceId))
}

/**
 * Mark an invoice Invalid so it can no longer be paid. Used only on an invoice
 * nothing was paid into (see the provider's `retireInvoice`).
 */
export function invalidateInvoice(cfg: BtcpayConfig, storeId: string, invoiceId: string): Promise<BtcpayInvoice> {
  return callInvoice<BtcpayInvoice>(cfg, "POST", storeId, `${encodeURIComponent(invoiceId)}/status`, { status: "Invalid" })
}

export type BtcpayPullPayment = { id: string; viewLink?: string }

/**
 * Refund = a pull payment for `amount` in the invoice's fiat currency at the
 * current rate. The buyer opens `viewLink` and claims it to their address.
 */
export function refundInvoice(
  cfg: BtcpayConfig,
  storeId: string,
  invoiceId: string,
  amount: string,
  currency: string
): Promise<BtcpayPullPayment> {
  return callInvoice<BtcpayPullPayment>(cfg, "POST", storeId, `${encodeURIComponent(invoiceId)}/refund`, {
    refundVariant: "Custom",
    customAmount: amount,
    customCurrency: currency,
    name: `Refund for invoice ${invoiceId}`,
  })
}

export type BtcpayWebhook = { id: string; url: string; enabled?: boolean }

export function listWebhooks(cfg: BtcpayConfig, storeId: string): Promise<BtcpayWebhook[]> {
  return call<BtcpayWebhook[]>(cfg, "GET", `/api/v1/stores/${encodeURIComponent(storeId)}/webhooks`)
}

export function createWebhook(cfg: BtcpayConfig, storeId: string, url: string, secret: string): Promise<BtcpayWebhook> {
  return call<BtcpayWebhook>(cfg, "POST", `/api/v1/stores/${encodeURIComponent(storeId)}/webhooks`, {
    url,
    secret,
    enabled: true,
    automaticRedelivery: true,
    authorizedEvents: { everything: true },
  })
}

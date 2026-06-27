/**
 * Orchestrates a verified PayU payment-link webhook into an order.
 *
 * Authoritative gate = server-side re-verification, NOT the inbound hash (PayU
 * signs link webhooks with the unreproducible Salt-v2/RSA scheme — see
 * verify-payment.ts). Flow: re-query PayU for the txn (classic `verify_payment`,
 * then OneAPI `/txns` as a fallback); only if PayU independently confirms the
 * payment is successful and covers the cart total do we complete the cart.
 *
 * The inbound `hash` is verified best-effort by the route for logging only; it
 * never gates completion (a valid hash is also replay-able, so re-query wins).
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  isLinkPaid,
  oneapiHosts,
  oneapiLinkTxnsUrl,
} from "../payment-link/lib"
import { completeCartFromExternalPayment } from "./complete-from-external"
import { verifyPayuTransaction, type VerifyResult } from "./verify-payment"

export type ProcessResult = {
  completed: boolean
  order_id: string | null
  reason?: string
}

export type ProcessDeps = {
  /** Re-verify a transaction with PayU. Injected in tests; defaults to verify_payment. */
  verifyTransaction?: (
    txnid: string,
    minAmount?: number
  ) => Promise<VerifyResult | null>
}

/**
 * @param payload the (hash-verified-or-not) webhook payload; must carry a
 *   success status, `udf1` (cart id) and `txnid`.
 */
export async function processPayuLinkWebhook(
  scope: any,
  payload: Record<string, any>,
  deps: ProcessDeps = {}
): Promise<ProcessResult> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const cartId = String(payload.udf1 || "")
  const txnid = String(payload.txnid || "")

  if (!cartId) {
    return { completed: false, order_id: null, reason: "no_cart_id" }
  }

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "total", "metadata"],
    filters: { id: cartId },
  })
  const cart = carts?.[0] as any
  if (!cart) {
    return { completed: false, order_id: null, reason: "cart_not_found" }
  }
  const minAmount = cart.total ? Number(cart.total) : undefined

  // 1) Primary re-verification: classic verify_payment (needs only key+salt+txnid).
  const verify =
    deps.verifyTransaction ??
    (async (id: string, min?: number) => {
      const key = process.env.PAYU_MERCHANT_KEY
      const salt = process.env.PAYU_MERCHANT_SALT
      if (!key || !salt || !id) return null
      return verifyPayuTransaction({
        key,
        salt,
        mode: process.env.PAYU_MODE,
        txnid: id,
        minAmount: min,
      })
    })

  let paid = false
  try {
    const v = await verify(txnid, minAmount)
    if (v?.paid) paid = true
    else if (v) {
      logger.warn(
        `[PayU Webhook] verify_payment says not-paid for txn ${txnid} (status=${v.status}, amount=${v.amount})`
      )
    }
  } catch (e: any) {
    logger.warn(`[PayU Webhook] verify_payment error for txn ${txnid}: ${e.message}`)
  }

  // 2) Fallback: OneAPI /payment-links/{invoice}/txns, if configured + invoice known.
  if (!paid) {
    const invoice = cart?.metadata?.payu_invoice_number
    const clientId = process.env.PAYU_CLIENT_ID
    const clientSecret = process.env.PAYU_CLIENT_SECRET
    const merchantId = process.env.PAYU_MERCHANT_ID
    if (clientId && clientSecret && merchantId && invoice) {
      try {
        const hosts = oneapiHosts(process.env.PAYU_ONEAPI_MODE)
        const tr = await fetch(hosts.token, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
            scope: "read_payment_links",
          }).toString(),
        })
        const tj: any = await tr.json().catch(() => ({}))
        if (tj.access_token) {
          const vr = await fetch(
            oneapiLinkTxnsUrl(process.env.PAYU_ONEAPI_MODE, String(invoice)),
            {
              headers: {
                Authorization: `Bearer ${tj.access_token}`,
                merchantId: String(merchantId),
              },
            }
          )
          const vj: any = await vr.json().catch(() => ({}))
          if (isLinkPaid(vj, minAmount ? Math.round(minAmount) : undefined).paid) {
            paid = true
          }
        }
      } catch (e: any) {
        logger.warn(`[PayU Webhook] OneAPI re-verify error for invoice ${invoice}: ${e.message}`)
      }
    }
  }

  if (!paid) {
    return { completed: false, order_id: null, reason: "not_verified" }
  }

  // Verified by PayU → complete the cart into an order (idempotent).
  const result = await completeCartFromExternalPayment(scope, cartId, {
    provider: "payu_link",
    txnid: payload.txnid,
    mihpayid: payload.mihpayid,
    mode: payload.mode,
    bank_ref_num: payload.bank_ref_num,
  })
  return { completed: true, order_id: result.order_id }
}

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createHash } from "crypto"
import {
  isLinkPaid,
  oneapiHosts,
  oneapiLinkTxnsUrl,
  verifyWebhookHash,
} from "../../../store/payu/payment-link/lib"
import { completeCartFromExternalPayment } from "../../../store/payu/lib/complete-from-external"

/**
 * POST /webhooks/payu/link — PayU dashboard webhook for payment-link payments.
 *
 * Lives outside /store (no publishable key). Verify-then-complete:
 *  1) validate the reverse-SHA512 webhook hash with PAYU_MERCHANT_SALT,
 *  2) re-query OneAPI /payment-links/{invoice}/txns to independently confirm the
 *     payment is actually success + covers the amount (don't trust the webhook
 *     alone — it can be replayed),
 *  3) complete the cart (udf1) into an order via completeCartFromExternalPayment.
 *
 * Always returns 200 once the signature is valid so PayU stops retrying; the
 * actual completion is best-effort and idempotent.
 */
const sha512Hex = (s: string) => createHash("sha512").update(s).digest("hex")

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  // PayU posts application/x-www-form-urlencoded.
  let payload = (req.body || {}) as Record<string, any>
  if ((!payload || !Object.keys(payload).length) && (req as any).rawBody) {
    payload = Object.fromEntries(new URLSearchParams((req as any).rawBody.toString()))
  }

  const salt = process.env.PAYU_MERCHANT_SALT
  if (!salt) {
    logger.error("[PayU Webhook] PAYU_MERCHANT_SALT not set; cannot verify")
    return res.status(500).json({ message: "not configured" })
  }
  if (!verifyWebhookHash(payload, salt, sha512Hex)) {
    logger.warn(`[PayU Webhook] hash verification failed (txnid=${payload.txnid})`)
    return res.status(401).json({ message: "invalid signature" })
  }

  const status = String(payload.status || "").toLowerCase()
  const cartId = payload.udf1
  if (status !== "success" || !cartId) {
    // Verified but not a successful link payment we own → ack, do nothing.
    return res.status(200).json({ received: true })
  }

  // Independent re-verification via OneAPI (recommended), when configured.
  try {
    const clientId = process.env.PAYU_CLIENT_ID
    const clientSecret = process.env.PAYU_CLIENT_SECRET
    const merchantId = process.env.PAYU_MERCHANT_ID
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: ["id", "metadata", "total"],
      filters: { id: cartId },
    })
    const cart = carts?.[0] as any
    const invoice = cart?.metadata?.payu_invoice_number

    if (clientId && clientSecret && merchantId && invoice) {
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
          { headers: { Authorization: `Bearer ${tj.access_token}`, merchantId: String(merchantId) } }
        )
        const vj: any = await vr.json().catch(() => ({}))
        const verdict = isLinkPaid(vj, cart?.total ? Math.round(Number(cart.total)) : undefined)
        if (!verdict.paid) {
          logger.warn(`[PayU Webhook] OneAPI says not paid for invoice ${invoice}; skipping completion`)
          return res.status(200).json({ received: true, completed: false })
        }
      } else {
        logger.warn("[PayU Webhook] could not get OneAPI token to re-verify; proceeding on hash only")
      }
    } else {
      logger.warn("[PayU Webhook] OneAPI not configured or no invoice on cart; proceeding on hash only")
    }
  } catch (e: any) {
    logger.warn(`[PayU Webhook] re-verification error (proceeding on hash): ${e.message}`)
  }

  // Verified → complete the cart into an order (idempotent).
  try {
    const result = await completeCartFromExternalPayment(req.scope, cartId, {
      provider: "payu_link",
      txnid: payload.txnid,
      mihpayid: payload.mihpayid,
      mode: payload.mode,
      bank_ref_num: payload.bank_ref_num,
    })
    return res.status(200).json({ received: true, completed: true, order_id: result.order_id })
  } catch (e: any) {
    logger.error(`[PayU Webhook] completion failed for cart ${cartId}: ${e.message}`)
    // Ack anyway so PayU doesn't hammer retries; reconcile out of band.
    return res.status(200).json({ received: true, completed: false, error: e.message })
  }
}

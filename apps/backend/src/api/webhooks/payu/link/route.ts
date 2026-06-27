import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createHash } from "crypto"
import { verifyWebhookHash } from "../../../store/payu/payment-link/lib"
import { processPayuLinkWebhook } from "../../../store/payu/lib/process-link-webhook"

/**
 * POST /webhooks/payu/link — PayU dashboard webhook for payment-link payments.
 *
 * Lives outside /store (no publishable key). Verify-then-complete, where the
 * authoritative check is an independent server-side re-query of PayU — NOT the
 * inbound hash. (Live testing showed PayU signs link webhooks with the Salt-v2
 * 256-bit/RSA scheme, which it does not publish a verification method for, so we
 * cannot reproduce the hash locally. Re-query is also replay-proof, so it's the
 * better gate regardless.)
 *
 *  1) best-effort: verify the classic Salt-v1 reverse hash — for LOGGING only;
 *  2) re-query PayU (`verify_payment`, then OneAPI `/txns`) to independently
 *     confirm the payment is successful and covers the cart amount;
 *  3) only then complete the cart (udf1) into an order, idempotently.
 *
 * Always 200 once we've decided, so PayU stops retrying; completion is
 * best-effort + idempotent and any gap is reconciled out of band.
 */
const sha512Hex = (s: string) => createHash("sha512").update(s).digest("hex")

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  // PayU posts application/x-www-form-urlencoded.
  let payload = (req.body || {}) as Record<string, any>
  if ((!payload || !Object.keys(payload).length) && (req as any).rawBody) {
    payload = Object.fromEntries(new URLSearchParams((req as any).rawBody.toString()))
  }

  const status = String(payload.status || "").toLowerCase()
  const cartId = payload.udf1
  if (status !== "success" || !cartId) {
    // Not a successful link payment we own → ack, do nothing.
    return res.status(200).json({ received: true })
  }

  // Best-effort hash check — LOGGING only, never a gate (PayU may have signed
  // with Salt v2, which we can't reproduce; re-verification below is the gate).
  const salt = process.env.PAYU_MERCHANT_SALT
  const hashOk = !!salt && verifyWebhookHash(payload, salt, sha512Hex)
  if (!hashOk) {
    logger.info(
      `[PayU Webhook] inbound hash not verified with Salt v1 (txnid=${payload.txnid}); relying on server-side re-verification`
    )
  }

  try {
    const result = await processPayuLinkWebhook(req.scope, payload)
    if (result.completed) {
      return res.status(200).json({ received: true, completed: true, order_id: result.order_id })
    }
    logger.warn(
      `[PayU Webhook] not completed for cart ${cartId} (reason=${result.reason})`
    )
    return res.status(200).json({ received: true, completed: false, reason: result.reason })
  } catch (e: any) {
    logger.error(`[PayU Webhook] completion failed for cart ${cartId}: ${e.message}`)
    // Ack anyway so PayU doesn't hammer retries; reconcile out of band.
    return res.status(200).json({ received: true, completed: false, error: e.message })
  }
}

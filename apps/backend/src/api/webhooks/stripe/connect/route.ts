import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { logger } from "@medusajs/framework"
import { Modules, PaymentActions } from "@medusajs/framework/utils"
import { processPaymentWorkflow } from "@medusajs/core-flows"
import { PARTNER_PAYMENT_CONFIG_MODULE } from "../../../../modules/partner-payment-config"
import {
  getPlatformStripe,
  accountToConnectFields,
} from "../../../../modules/partner-payment-config/lib/stripe-connect"

// Must match the provider registration (id "stripe-connect") — the payment
// module derives the provider id as `pp_${provider}`.
const CONNECT_PAYMENT_PROVIDER = "stripe-connect_stripe-connect"

/**
 * POST /webhooks/stripe/connect
 *
 * Receives Stripe Connect events for JYT's platform account:
 *  - account.updated / account.application.deauthorized → keep the
 *    partner_payment_config Connect columns in sync (onboarding status).
 *  - payment_intent.* (direct charges on connected accounts are delivered here,
 *    not to the per-provider /hooks route) → dispatch into the payment module
 *    so the payment session is captured/authorized/failed, mirroring the core
 *    payment-webhook subscriber.
 *
 * Signature is verified against STRIPE_CONNECT_WEBHOOK_SECRET using the raw
 * request bytes (middleware sets bodyParser: { preserveRawBody: true }).
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  const signature = req.headers["stripe-signature"] as string | undefined
  const rawBody = (req as any).rawBody as Buffer | undefined

  if (!secret) {
    logger.error("[stripe-connect-webhook] STRIPE_CONNECT_WEBHOOK_SECRET not set")
    // 500 so Stripe retries once the secret is configured.
    return res.status(500).send("Webhook secret not configured")
  }
  if (!signature || !rawBody?.length) {
    return res.status(400).send("Missing signature or body")
  }

  let event: any
  try {
    const stripe = await getPlatformStripe()
    event = stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch (e: any) {
    logger.warn(`[stripe-connect-webhook] signature verification failed: ${e?.message}`)
    return res.status(400).send(`Webhook Error: ${e?.message}`)
  }

  // Payment events (direct charges on connected accounts) → drive the payment
  // session. Delegates to our provider's getWebhookActionAndData + the core
  // processPaymentWorkflow, exactly like Medusa's built-in payment-webhook
  // subscriber (which never sees these because they arrive on the Connect
  // endpoint). Signature is already verified above.
  if (typeof event.type === "string" && event.type.startsWith("payment_intent.")) {
    try {
      const paymentService: any = req.scope.resolve(Modules.PAYMENT)
      const processed = await paymentService.getWebhookActionAndData({
        provider: CONNECT_PAYMENT_PROVIDER,
        payload: { data: event, rawData: rawBody, headers: req.headers },
      })

      const skip =
        !processed?.data?.session_id ||
        processed.action === PaymentActions.NOT_SUPPORTED ||
        processed.action === PaymentActions.CANCELED ||
        processed.action === PaymentActions.FAILED ||
        processed.action === PaymentActions.REQUIRES_MORE

      if (!skip) {
        await processPaymentWorkflow(req.scope).run({ input: processed })
        logger.info(
          `[stripe-connect-webhook] ${event.type} → ${processed.action} ` +
            `session=${processed.data.session_id}`
        )
      }
    } catch (e: any) {
      logger.error(`[stripe-connect-webhook] payment dispatch error: ${e?.message}`)
      return res.status(500).send("Payment handler error")
    }
    return res.json({ received: true })
  }

  // On Connect account events, the connected account id is at the top level.
  const accountId: string | undefined = event.account
  const configService = req.scope.resolve(PARTNER_PAYMENT_CONFIG_MODULE) as any

  try {
    switch (event.type) {
      case "account.updated": {
        const account = event.data.object
        const id = account?.id || accountId
        const config = await configService.findByConnectAccountId(id)
        if (!config) {
          logger.info(`[stripe-connect-webhook] no config for account ${id}; ignoring`)
          break
        }
        const fields = accountToConnectFields(account)
        await configService.updatePartnerPaymentConfigs({ id: config.id, ...fields })
        logger.info(
          `[stripe-connect-webhook] account ${id} → ${fields.connect_status} ` +
            `(charges=${fields.connect_charges_enabled}) for partner ${config.partner_id}`
        )
        break
      }
      case "account.application.deauthorized": {
        const config = await configService.findByConnectAccountId(accountId)
        if (!config) break
        await configService.updatePartnerPaymentConfigs({
          id: config.id,
          connect_status: "disconnected",
          connect_charges_enabled: false,
          connect_payouts_enabled: false,
        })
        logger.info(
          `[stripe-connect-webhook] account ${accountId} deauthorized for partner ${config.partner_id}`
        )
        break
      }
      default:
        // Acknowledge unhandled events so Stripe stops retrying.
        break
    }
  } catch (e: any) {
    logger.error(`[stripe-connect-webhook] handler error: ${e?.message}`)
    // 500 → Stripe retries.
    return res.status(500).send("Handler error")
  }

  res.json({ received: true })
}

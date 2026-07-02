import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { logger } from "@medusajs/framework"
import { PARTNER_PAYMENT_CONFIG_MODULE } from "../../../../modules/partner-payment-config"
import {
  getPlatformStripe,
  accountToConnectFields,
} from "../../../../modules/partner-payment-config/lib/stripe-connect"

/**
 * POST /webhooks/stripe/connect
 *
 * Receives Stripe Connect account events for JYT's platform account. Keeps the
 * partner_payment_config Connect columns in sync with Stripe as partners finish
 * (or lose) onboarding.
 *
 * Signature is verified against STRIPE_CONNECT_WEBHOOK_SECRET using the raw
 * request bytes (middleware sets bodyParser: { preserveRawBody: true }).
 *
 * Handled events:
 *  - account.updated              → refresh charges/payouts/details + status
 *  - account.application.deauthorized → partner disconnected → mark disconnected
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

  // On Connect events, the connected account id is at the top level.
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

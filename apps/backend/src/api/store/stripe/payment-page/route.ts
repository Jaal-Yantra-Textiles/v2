/**
 * POST /store/stripe/payment-page
 *
 * Ensure a cart has an initialized Stripe payment session and return a shareable
 * hosted-page URL (`/stripe/pay/:cart_id`) where the shopper enters their card
 * (and wallets). The page confirms the cart's OWN PaymentIntent — the one admin
 * captures — and core's payment webhook completes the cart into an order. This
 * is the non-INR mirror of /store/payu/payment-link.
 *
 * Body: { cart_id }. Requires STRIPE_PUBLISHABLE_KEY (for the page) and a Stripe
 * provider enabled on the cart's region.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ensureStripeSession } from "../lib/init-session"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req.body || {}) as Record<string, any>
  const cartId = body.cart_id

  if (!cartId || typeof cartId !== "string") {
    return res.status(400).json({ message: "cart_id is required" })
  }

  let result
  try {
    result = await ensureStripeSession(req.scope, cartId)
  } catch (e: any) {
    logger.error(`[Stripe Page] failed for cart ${cartId}: ${e?.message}`)
    return res.status(502).json({ message: "Failed to initialize Stripe payment", error: e?.message })
  }

  if (!result.ok) {
    return res.status(result.status).json({ type: "cart", error: result.error })
  }

  const baseUrl = (process.env.MEDUSA_BACKEND_URL || "").replace(/\/+$/, "")
  const url = `${baseUrl}/stripe/pay/${encodeURIComponent(cartId)}`

  if (!process.env.STRIPE_PUBLISHABLE_KEY) {
    logger.warn("[Stripe Page] STRIPE_PUBLISHABLE_KEY is not set — the hosted page will not render until it is configured")
  }

  return res.json({
    type: "stripe_payment_page",
    url,
    payment_session_id: result.payment_session_id,
    provider_id: result.provider_id,
    client_secret: result.client_secret,
    amount: result.amount,
    currency_code: result.currency_code,
  })
}

/**
 * GET /stripe/pay/:id — self-hosted Stripe Payment Element page for a cart.
 *
 * `:id` is the CART id. The page mounts Stripe's Payment Element against the
 * cart's own Medusa Stripe payment session (its `client_secret`), so the
 * customer pays the SAME PaymentIntent the admin later captures. On success,
 * core's payment webhook (`payment_intent.*`) completes the cart into an order —
 * no custom completion code here. See ./lib/payment-page.ts for the rationale.
 *
 * Public (lives outside /store, no publishable key): the customer opens this URL
 * directly in a browser. The cart id is unguessable, mirroring a PayU link.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  buildStripePaymentPageHtml,
  clientSecretOf,
  formatAmount,
  pickStripeSession,
} from "../../lib/payment-page"

// Allow Stripe.js + our inline bootstrap; keep everything else self-only.
const STRIPE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "connect-src 'self' https://api.stripe.com",
  "img-src 'self' data:",
].join("; ")

const sendHtml = (res: MedusaResponse, status: number, html: string) => {
  res.status(status)
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.setHeader("Content-Security-Policy", STRIPE_CSP)
  res.send(html)
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const cartId = req.params.id

  let cart: any
  try {
    const { data } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "completed_at",
        "currency_code",
        "total",
        "payment_collection.payment_sessions.id",
        "payment_collection.payment_sessions.provider_id",
        "payment_collection.payment_sessions.amount",
        "payment_collection.payment_sessions.currency_code",
        "payment_collection.payment_sessions.data",
      ],
      filters: { id: cartId },
    })
    cart = data?.[0]
  } catch (e: any) {
    logger.error(`[Stripe Pay] cart lookup failed for ${cartId}: ${e?.message}`)
    return sendHtml(
      res,
      500,
      buildStripePaymentPageHtml({ state: "unavailable", message: "Something went wrong loading this payment. Please try again later." })
    )
  }

  if (!cart) {
    return sendHtml(res, 404, buildStripePaymentPageHtml({ state: "unavailable", message: "This payment link is not valid." }))
  }

  // Already turned into an order (paid earlier, or webhook completed it).
  if (cart.completed_at) {
    return sendHtml(res, 200, buildStripePaymentPageHtml({ state: "paid" }))
  }

  const session = pickStripeSession(cart)
  const clientSecret = clientSecretOf(session)
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY

  if (!session || !clientSecret) {
    return sendHtml(
      res,
      400,
      buildStripePaymentPageHtml({ state: "unavailable", message: "No Stripe payment is initialized for this cart yet." })
    )
  }
  if (!publishableKey) {
    logger.error("[Stripe Pay] STRIPE_PUBLISHABLE_KEY is not configured")
    return sendHtml(
      res,
      500,
      buildStripePaymentPageHtml({ state: "unavailable", message: "Card payments are temporarily unavailable." })
    )
  }

  const amountLabel = formatAmount(
    session.amount ?? cart.total,
    session.currency_code ?? cart.currency_code
  )
  const baseUrl = (process.env.MEDUSA_BACKEND_URL || "").replace(/\/+$/, "")
  const returnUrl = `${baseUrl}/stripe/pay/${encodeURIComponent(cartId)}`

  return sendHtml(
    res,
    200,
    buildStripePaymentPageHtml({
      state: "pay",
      publishableKey,
      clientSecret,
      amountLabel,
      returnUrl,
      title: "Complete your payment",
    })
  )
}

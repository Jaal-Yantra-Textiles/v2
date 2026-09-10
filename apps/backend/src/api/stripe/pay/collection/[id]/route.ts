/**
 * GET /stripe/pay/collection/:id — the buyer's page for an OUTSTANDING payment
 * collection (#1985).
 *
 * `:id` is the PAYMENT COLLECTION id. This is the rail for money raised by an
 * order EDIT: adding or re-pointing items leaves the order owing a difference,
 * and core records that as a second, non-completed payment collection.
 *
 * ## Why this route exists
 *
 * The admin's "Copy payment link" button builds
 * `${storefrontUrl}/payment-collection/:id?order_id=:order` and hands it to the
 * operator. Two things were wrong with that: `storefrontUrl` was never
 * configured (so the copied string had no host at all), and no storefront
 * implements that page — in EITHER of our two storefront apps. Pointing the
 * button at the backend instead means ONE implementation rather than two, on
 * the same hosted-Stripe rail the deposit and the balance already use and that
 * is already proven in production.
 *
 * It also stays correct for every tenant. The storefront is multi-tenant — the
 * house shop and partner shops are different apps on different domains — but
 * `storefrontUrl` is a single value baked into the admin bundle at BUILD time,
 * so it could only ever have named one of them. The backend is single, and this
 * page resolves the partner's Stripe Connect routing per collection.
 *
 * ## Unlike `stripe/pay/balance/:id`
 *
 * The balance page's session is minted by `request-order-balance` before the
 * link is sent. Nothing mints one for an order edit, so this page creates it on
 * demand — see `ensureStripeSessionForCollection`.
 *
 * Public, like the deposit's page, the balance page and a PayU link: the buyer
 * opens it directly and the unguessable ULID is the credential.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  buildStripePaymentPageHtml,
  clientSecretOf,
  formatAmount,
} from "../../../lib/payment-page"
import {
  ensureStripeSessionForCollection,
  isCollectionSettled,
} from "../../../../../lib/payments/ensure-stripe-session"

// Allow Stripe.js + our inline bootstrap; keep everything else self-only.
// Identical to the cart and balance pages — the three must not drift, or one
// of them silently stops loading Stripe.
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

/** The public origin this page is served from, for Stripe's return_url. */
export const backendOrigin = (): string =>
  (process.env.MEDUSA_BACKEND_URL || "https://v3.jaalyantra.com").replace(
    /\/+$/,
    ""
  )

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const collectionId = req.params.id

  const { collection, session } = await ensureStripeSessionForCollection(
    req.scope,
    collectionId
  )

  if (!collection) {
    return sendHtml(
      res,
      404,
      buildStripePaymentPageHtml({
        state: "unavailable",
        title: "Payment link",
        message: "This payment link is not valid.",
      })
    )
  }

  /**
   * Paid is a first-class page, not a 404 — the same rule the balance page
   * follows. A buyer who pays and then reopens the link must be told the money
   * arrived, not shown an error that makes them wonder whether it did.
   */
  if (isCollectionSettled(collection)) {
    return sendHtml(
      res,
      200,
      buildStripePaymentPageHtml({
        state: "paid",
        title: "Payment received",
        message:
          "This payment has already been made. You can close this window.",
      })
    )
  }

  const clientSecret = clientSecretOf(session)
  const publishableKey =
    process.env.STRIPE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_STRIPE_KEY ||
    null

  if (!clientSecret || !publishableKey) {
    // Deliberately specific in the log and vague on the page: the buyer cannot
    // act on "no client secret", and the operator cannot act on "unavailable".
    logger?.error?.(
      `[pay-collection] cannot render collection=${collectionId} ` +
        `client_secret=${clientSecret ? "yes" : "no"} ` +
        `pk=${publishableKey ? "yes" : "no"}`
    )
    return sendHtml(
      res,
      200,
      buildStripePaymentPageHtml({
        state: "unavailable",
        title: "Payment link",
        message:
          "This payment link cannot be opened just now. Please contact us and we will send a new one.",
      })
    )
  }

  return sendHtml(
    res,
    200,
    buildStripePaymentPageHtml({
      state: "pay",
      publishableKey,
      clientSecret,
      amountLabel: formatAmount(collection.amount, collection.currency_code),
      title: "Complete your payment",
      // Back to this same page: on return it re-reads the collection and, if
      // the money landed, renders the paid state instead of the form.
      returnUrl: `${backendOrigin()}/stripe/pay/collection/${collectionId}`,
    })
  )
}

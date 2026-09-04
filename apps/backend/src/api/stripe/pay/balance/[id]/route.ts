/**
 * GET /stripe/pay/balance/:id — the buyer's page for the BALANCE of an order.
 *
 * `:id` is the PAYMENT SCHEDULE id, not a cart and not a payment collection.
 * The schedule is the one identifier that survives a retry — a failed session
 * is deleted and remade, and a collection could in principle be replaced — so
 * a link already sent by email keeps working.
 *
 * ## Why this exists rather than a Stripe Payment Link
 *
 * Stripe's Payment Links are a fine way to ask for money, but they live outside
 * Medusa: the charge arrives as an object with no payment collection, no order
 * association and nothing for the admin to capture or reconcile against. This
 * page mounts the Payment Element against the balance collection's OWN Medusa
 * session, so the money lands in the same records as the deposit did and the
 * order's `paid_total` moves on its own. It is the same rail the deposit used,
 * which is the rail that has now been proven in production.
 *
 * Public, like the deposit's page and a PayU link: the buyer opens it directly
 * and the unguessable id is the credential.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  buildStripePaymentPageHtml,
  clientSecretOf,
  formatAmount,
} from "../../../lib/payment-page"
import { PAYMENT_SCHEDULE_MODULE } from "../../../../../modules/payment_schedule"
import { reconcileBalanceForSchedule } from "../../../../../lib/payments/reconcile-balance"

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
  const scheduleId = req.params.id

  let schedule: any
  try {
    const schedules: any = req.scope.resolve(PAYMENT_SCHEDULE_MODULE)
    schedule = await schedules.retrievePaymentSchedule(scheduleId)
  } catch {
    schedule = null
  }

  /**
   * 🔑 Reconcile FIRST, then render.
   *
   * The payment module emits no events, so nothing tells us the balance landed.
   * The buyer returning to this page after paying is the earliest reliable
   * moment we get — so we look at what the collection actually captured before
   * deciding what to show. Without this, a buyer who has just paid would be
   * shown the payment form again.
   *
   * Best-effort: a reconcile failure must not replace a working payment page
   * with an error. The maintenance sweep is the backstop.
   */
  if (schedule) {
    try {
      const rec = await reconcileBalanceForSchedule(req.scope, scheduleId)
      if (rec.marked_paid) {
        schedule = { ...schedule, balance_status: "paid" }
      }
    } catch (e: any) {
      logger?.warn?.(`[balance-page] reconcile failed: ${e?.message ?? e}`)
    }
  }

  if (!schedule) {
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
   * Paid is a first-class page, not a 404. A buyer who pays and then reopens
   * the link from their email must be told the money arrived, not shown an
   * error that makes them wonder whether it did.
   */
  if (schedule.balance_status === "paid") {
    return sendHtml(
      res,
      200,
      buildStripePaymentPageHtml({
        state: "paid",
        title: "Balance paid",
        message: "The balance on this order has been paid. You can close this window.",
      })
    )
  }

  if (schedule.balance_status === "waived") {
    return sendHtml(
      res,
      200,
      buildStripePaymentPageHtml({
        state: "paid",
        title: "Nothing to pay",
        message: "The balance on this order was waived. There is nothing more to pay.",
      })
    )
  }

  /**
   * `not_due` means no partner has raised the balance yet. That is a real state
   * — the goods are still being made — and saying so is kinder than a dead
   * link, which is what a buyer would otherwise report as a broken email.
   */
  if (schedule.balance_status !== "due") {
    return sendHtml(
      res,
      200,
      buildStripePaymentPageHtml({
        state: "unavailable",
        title: "Not due yet",
        message:
          "The balance on this order is not due yet. You will be sent a link when your order is ready.",
      })
    )
  }

  /**
   * 🔴 The balance collection is the order's NON-completed one, not one found
   * by a marker of ours. `createOrUpdateOrderPaymentCollectionWorkflow` creates
   * it and writes no marker — the deposit's collection is `completed` and this
   * one is not, which is the same distinction core itself uses.
   *
   * Matching the amount as well makes "this is the balance" defensible rather
   * than positional: picking the wrong collection would show the buyer the
   * deposit's figure a second time.
   */
  let collection: any = null
  try {
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "payment_collections.id",
        "payment_collections.amount",
        "payment_collections.status",
        "payment_collections.currency_code",
        "payment_collections.payment_sessions.id",
        "payment_collections.payment_sessions.provider_id",
        "payment_collections.payment_sessions.status",
        "payment_collections.payment_sessions.data",
      ],
      filters: { id: schedule.order_id },
    })
    const collections = ((data?.[0] as any)?.payment_collections ?? []) as any[]
    const expected = Number(schedule.balance_amount)
    collection =
      collections.find(
        (c) =>
          c?.status !== "completed" &&
          Number.isFinite(Number(c?.amount)) &&
          Math.round(Number(c.amount) * 100) === Math.round(expected * 100)
      ) ?? collections.find((c) => c?.status !== "completed") ?? null
  } catch (e: any) {
    logger?.warn?.(`[balance-page] collection lookup failed: ${e?.message ?? e}`)
  }

  const session = (collection?.payment_sessions ?? []).find((s: any) =>
    String(s?.provider_id ?? "").includes("stripe")
  )
  const clientSecret = clientSecretOf(session)
  const publishableKey =
    process.env.STRIPE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_STRIPE_KEY || null

  if (!collection || !clientSecret || !publishableKey) {
    // Deliberately specific in the log and vague on the page: the buyer cannot
    // act on "no client secret", and the operator cannot act on "unavailable".
    logger?.error?.(
      `[balance-page] cannot render schedule=${scheduleId} collection=${
        collection?.id ?? "none"
      } client_secret=${clientSecret ? "yes" : "no"} pk=${publishableKey ? "yes" : "no"}`
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
      title: "Pay the balance of your order",
      returnUrl: `${(
        process.env.MEDUSA_BACKEND_URL || "https://v3.jaalyantra.com"
      ).replace(/\/+$/, "")}/stripe/pay/balance/${scheduleId}`,
    })
  )
}

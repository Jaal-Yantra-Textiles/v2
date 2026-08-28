/**
 * @route /admin/inventory-orders/:id/payments
 * @scope admin
 *
 * What we have paid, or owe, the partner FOR THIS ORDER (#1622).
 *
 * 🔴 Read off the submission LINES, not off the payment link.
 *
 * The order page already had a payments panel, and it already read
 * `internal_payments` — the link `linkPaymentToInventoryOrderStep` writes. That
 * link is drawn only when a payout is APPROVED, and only for payouts approved
 * since #1621. So an order whose payout is still Pending shows nothing, an
 * order paid before #1621 shows nothing, and in both cases the screen said
 * "No payments to show yet" — which reads as *nobody has been billed*, not as
 * *this surface cannot see it*. On prod that is 3 of the 4 payouts written on
 * 2026-08-28.
 *
 * `payment_submission_item.inventory_order_id` has named the order from the
 * moment the line was written, at every status. Reading that answers the
 * question for Draft, Pending, Paid and pre-link rows alike, and needs no
 * backfill. The link is still returned — as `payments` — because it carries
 * the actual money movement (payment_type, date, attachments) that a line
 * does not.
 *
 * ⚠️ A submission may name SEVERAL sources; reconciliation records such a
 * payout as `mixed` with a null `source_id`. That is exactly why this queries
 * items rather than reconciliations: a mixed payout must stay visible from
 * every order it touches.
 *
 * Response: { payouts, payments, totals, count }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../../modules/payment_submissions"
import type PaymentSubmissionsService from "../../../../../modules/payment_submissions/service"
import { foldOrderPayouts } from "./fold"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const service: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )

  const items = (await service.listPaymentSubmissionItems({
    inventory_order_id: id,
  })) as any[]

  const submissionIds = Array.from(
    new Set(items.map((i) => i.submission_id).filter(Boolean))
  )

  const submissions = submissionIds.length
    ? ((await service.listPaymentSubmissions({ id: submissionIds })) as any[])
    : []

  const { payouts, billed, paid } = foldOrderPayouts(items, submissions)

  /**
   * The linked internal payments. Best-effort: a graph hiccup, or an order with
   * no link yet, must not turn a page that CAN answer the billing question into
   * an error.
   */
  let payments: any[] = []
  try {
    const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "inventory_orders",
      fields: ["id", "internal_payments.*", "internal_payments.attachments.*"],
      filters: { id },
    })
    const raw = data?.[0]?.internal_payments
    payments = !raw ? [] : Array.isArray(raw) ? raw.filter(Boolean) : [raw]
  } catch {
    payments = []
  }

  return res.status(200).json({
    payouts,
    payments,
    totals: {
      billed,
      paid,
      /** Money actually recorded as moved, from the payment records. */
      recorded: payments.reduce((acc, p) => acc + Number(p?.amount ?? 0), 0),
    },
    count: payouts.length,
  })
}

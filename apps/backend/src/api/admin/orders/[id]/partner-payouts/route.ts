/**
 * @route /admin/orders/:id/partner-payouts
 * @scope admin
 *
 * What this retail order cost us in partner labour (#1622).
 *
 * 🔴 A retail order's runs are linked to it, and the payout for those runs is
 * not. Order #79 is seven production runs and one ₹8,974 payout, and standing
 * on the order there was no way to learn the second half of that sentence.
 *
 * `payment_submission_item.order_id` was denormalised onto the line precisely
 * so a payout could be traced back to the order that caused it (#1598) — it
 * has simply never been read from this direction. Reading it here means every
 * status answers, Pending included, with no link and no backfill involved.
 *
 * Response: { payouts, totals, count }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../../../../modules/payment_submissions"
import type PaymentSubmissionsService from "../../../../../modules/payment_submissions/service"
import { foldOrderPayouts } from "../../../inventory-orders/[id]/payments/fold"
import {
  collectLineRefs,
  resolvePaymentEntities,
} from "../../../payment-submissions/lib/resolve-payment-entities"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const service: PaymentSubmissionsService = req.scope.resolve(
    PAYMENT_SUBMISSIONS_MODULE
  )

  const items = (await service.listPaymentSubmissionItems({
    order_id: id,
  })) as any[]

  const submissionIds = Array.from(
    new Set(items.map((i) => i.submission_id).filter(Boolean))
  )

  const submissions = submissionIds.length
    ? ((await service.listPaymentSubmissions({ id: submissionIds })) as any[])
    : []

  const { payouts, billed, paid } = foldOrderPayouts(items, submissions)

  /** Names for the partner and for each run the payout covers. */
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const resolved = await resolvePaymentEntities(query, {
    partnerIds: submissions.map((s) => s.partner_id),
    ...collectLineRefs(items),
  })

  const enriched = payouts.map((payout) => ({
    ...payout,
    partner: payout.partner_id
      ? resolved.partners.get(payout.partner_id) ?? null
      : null,
    design: payout.design_id ? resolved.designs.get(payout.design_id) ?? null : null,
    runs: (payout.production_run_ids || []).map(
      (runId: string) =>
        resolved.runs.get(runId) ?? { id: runId, name: runId, detail: null }
    ),
  }))

  return res.status(200).json({
    payouts: enriched,
    totals: { billed, paid },
    count: enriched.length,
  })
}

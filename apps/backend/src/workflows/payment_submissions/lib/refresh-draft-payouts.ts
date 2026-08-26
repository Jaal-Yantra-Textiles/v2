import { PAYMENT_SUBMISSIONS_MODULE } from "../../../modules/payment_submissions"
import { assessRunPayout } from "../../production-runs/lib/run-payable"

/**
 * Re-price the unclaimed DRAFT payouts that were pre-filled from a run, after
 * that run's money has been corrected.
 *
 * ## Why this exists
 *
 * `auto-draft-payment-submission` writes a Draft the moment a run completes,
 * using the figures the partner entered at that moment. Correcting the run
 * afterwards — a produced quantity, an agreed rate, a cost type — changed
 * nothing about that Draft. It kept the old numbers and went on looking
 * authoritative.
 *
 * On production: run `prod_run_01KZWX801S8HBNZ8DYBVNJK5GZ` was drafted at
 * ₹1,190/unit, then its rate was corrected to ₹840 total and its produced
 * quantity from 3 to 1. The Draft still said ₹1,190. Nothing in the system
 * disagreed with it, and a reviewer would have approved a figure that no longer
 * matched the run it came from.
 *
 * 🔴 There is no route that could have fixed it either. A submission has GET
 * and `review`, and `review` refuses anything that is not Pending or
 * Under_Review — so a stale Draft could not be edited, rejected, or discarded
 * through the API at all. Re-pricing it here is the repair AND the prevention.
 *
 * ## Only Draft, and only ever Draft
 *
 * ⚠️ A Draft is system-written and unsubmitted: nobody has claimed it, so
 * re-pricing it takes nothing away from anyone. Every other status is a live
 * claim — a partner has asked for that amount, or it has been approved or paid
 * — and silently rewriting one would change what somebody is owed without them
 * seeing it. Those are left exactly as they are; the correcting admin can
 * reject and re-raise if they need to.
 *
 * Uses `assessRunPayout`, the same function the subscriber drafted with, so a
 * refresh cannot quietly change the BASIS of the figure (it bills ordered, not
 * produced — see `runPayableAmount`). Only the inputs have changed, not the
 * rule.
 *
 * Best-effort by contract: the run correction is already persisted and must
 * never be rolled back because a downstream draft could not be re-priced.
 */
export const refreshUnclaimedDraftPayouts = async (
  scope: any,
  runId: string
): Promise<{ refreshed: string[]; skipped: string[] }> => {
  const refreshed: string[] = []
  const skipped: string[] = []

  const runService: any = scope.resolve("production_runs")
  const run = await runService.retrieveProductionRun(runId)

  const payout = assessRunPayout(run)
  if (!payout.eligible) {
    // No payable figure any more (rate cleared, run reopened). Leaving the
    // Draft alone is safer than zeroing it: a zero payout reads as a decision
    // that the work was worthless, which is exactly the #1564 mistake.
    return { refreshed, skipped }
  }

  const service: any = scope.resolve(PAYMENT_SUBMISSIONS_MODULE)

  const items = (await service.listPaymentSubmissionItems(
    { design_id: [String(run.design_id)] },
    { relations: ["submission"] }
  )) as any[]

  for (const item of items || []) {
    const claims = (item?.production_run_ids ?? []) as string[]
    if (!Array.isArray(claims) || !claims.includes(runId)) {
      continue
    }

    const status = String(item?.submission?.status || "")
    if (status !== "Draft") {
      // A live claim. Recorded so the caller can say so rather than silently
      // leaving a stale figure in place.
      skipped.push(String(item.submission?.id || item.submission_id || ""))
      continue
    }

    // A line can collapse several runs of one design; re-pricing from a single
    // run would then be wrong. Those are left for a human.
    if (claims.length > 1) {
      skipped.push(String(item.submission?.id || item.submission_id || ""))
      continue
    }

    const unchanged =
      Number(item.amount) === payout.amount &&
      Number(item.quantity) === payout.quantity &&
      Number(item.unit_amount) === payout.unit_amount
    if (unchanged) {
      continue
    }

    await service.updatePaymentSubmissionItems({
      id: item.id,
      amount: payout.amount,
      quantity: payout.quantity,
      unit_amount: payout.unit_amount,
    })

    // The submission total is stored, not derived, so it has to move too — a
    // line and a header that disagree is worse than either being wrong alone.
    const submissionId = String(item.submission?.id || item.submission_id || "")
    if (submissionId) {
      const siblings = (await service.listPaymentSubmissionItems(
        { submission_id: submissionId },
        {}
      )) as any[]
      const total = (siblings || []).reduce(
        (sum: number, s: any) =>
          sum + (String(s.id) === String(item.id) ? payout.amount : Number(s.amount) || 0),
        0
      )
      await service.updatePaymentSubmissions({
        id: submissionId,
        total_amount: Math.round(total * 100) / 100,
      })
      refreshed.push(submissionId)
    }
  }

  return { refreshed, skipped }
}

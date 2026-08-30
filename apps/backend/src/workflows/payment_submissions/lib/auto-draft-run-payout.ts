import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { PAYMENT_SUBMISSIONS_MODULE } from "../../../modules/payment_submissions"
import { assessRunPayout } from "../../production-runs/lib/run-payable"
import { createPaymentSubmissionWorkflow } from "../create-payment-submission"

/**
 * Pre-fill a partner's payment submission for one completed run.
 *
 * ## Why this is a function rather than a subscriber body
 *
 * It used to run in exactly one place: the moment `production_run.completed`
 * fired. That is the moment MOST of the facts exist — the design, the partner,
 * the ordered quantity, the cost the partner typed into the completion form —
 * but it is not the moment they ALL do.
 *
 * 🔴 A run completed with no agreed rate is `no_cost`, and nothing ever looked
 * at it again. On the local database 97 of 215 completed runs carry no cost;
 * the partner finished the job and no price was recorded. An admin setting that
 * price afterwards — through the cost drawer, which is the documented way —
 * produced no draft, ever. The work stayed unpaid unless somebody remembered to
 * raise a submission by hand.
 *
 * `refreshUnclaimedDraftPayouts` already runs on that same correction and
 * re-prices a Draft that EXISTS. This is its missing other half: create one
 * where none does. The two are deliberately adjacent in the update route.
 *
 * ⚠️ NOT triggered by an output correction. `runPayableAmount` bills the
 * ORDERED quantity by design (#456), so correcting `produced_quantity` does not
 * move this money and must not manufacture a draft.
 *
 * ## Idempotent, by asking rather than by catching
 *
 * The create workflow already refuses a design that sits in an open submission,
 * and the run-claim guard refuses a run already claimed — so a second call was
 * always safe. But relying on an exception means the log says "no draft
 * created — <some guard's message>" and the caller cannot tell "already done"
 * from "went wrong". This asks first, and says which.
 */

export type AutoDraftOutcome = {
  drafted: boolean
  /**
   * `drafted`, `already_claimed`, or the `assessRunPayout` reason
   * (`no_cost`, `no_partner`, `run_not_completed`, `provenance_run`, …).
   */
  reason: string
  submission_id?: string
  source: string
}

/**
 * Whether any payment submission line already names this run.
 *
 * Every status counts, Draft included: a Draft is a pre-fill that already
 * exists, and a second one would be two answers to one question.
 */
const runIsAlreadyClaimed = async (
  container: MedusaContainer,
  designId: string,
  runId: string
): Promise<boolean> => {
  const service: any = container.resolve(PAYMENT_SUBMISSIONS_MODULE)
  const items = (await service.listPaymentSubmissionItems(
    { design_id: [designId] },
    {}
  )) as any[]

  return (items || []).some((item) => {
    const claims = item?.production_run_ids
    return Array.isArray(claims) && claims.includes(runId)
  })
}

export const autoDraftRunPayout = async (
  container: MedusaContainer,
  runId: string,
  /** What caused this attempt — recorded on the draft so it can be traced. */
  source: string = "production_run.completed"
): Promise<AutoDraftOutcome> => {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productionRunService: any = container.resolve("production_runs")

  let run: any = null
  try {
    run = await productionRunService.retrieveProductionRun(runId)
  } catch {
    return { drafted: false, reason: "run_not_found", source }
  }

  const payout = assessRunPayout(run)
  if (!payout.eligible) {
    logger.info(
      `[auto-draft-payment-submission] run ${runId}: skipped (${payout.reason}) via ${source}`
    )
    return { drafted: false, reason: payout.reason, source }
  }

  if (await runIsAlreadyClaimed(container, payout.design_id, runId)) {
    logger.info(
      `[auto-draft-payment-submission] run ${runId}: already claimed, nothing to draft (${source})`
    )
    return { drafted: false, reason: "already_claimed", source }
  }

  try {
    const { result } = await createPaymentSubmissionWorkflow(container).run({
      input: {
        partner_id: payout.partner_id,
        design_ids: [payout.design_id],
        status: "Draft",
        // The completed run IS the proof of finished work — completion moves
        // the design to Technical_Review, which the hand-submission gate would
        // reject.
        require_design_status: false,
        notes:
          source === "production_run.completed"
            ? `Drafted automatically when production run ${runId} completed. Review the amount and submit when you're ready.`
            : `Drafted automatically when production run ${runId} was priced. Review the amount and submit when you're ready.`,
        /**
         * The run this draft pays for, in the column that guards the money.
         * Recording it ONLY in `metadata` is what made every auto-draft reach
         * the double-pay guard as "no run recorded" (#1565).
         */
        production_run_ids: { [payout.design_id]: [runId] },
        /** The money, as typed inputs rather than through `metadata` (#1554). */
        unit_amounts: { [payout.design_id]: payout.unit_amount },
        quantities: { [payout.design_id]: payout.quantity },
        metadata: {
          auto_drafted: true,
          source,
          production_run_id: runId,
          cost_type: run?.cost_type ?? null,
          ordered_quantity: run?.quantity ?? null,
          partner_cost_estimate: run?.partner_cost_estimate ?? null,
          /** The total the two fields below are expected to reproduce. */
          payable_amount: payout.amount,
          /**
           * 🔴 Deliberately NOT `design_cost_overrides`. A total override sets
           * `unit_amount` to null — there is no recorded rate behind a typed
           * total — which would throw away the very breakdown this path is the
           * one place that actually knows (#1554).
           */
          design_unit_amounts: { [payout.design_id]: payout.unit_amount },
          design_quantities: { [payout.design_id]: payout.quantity },
        },
      },
    })

    const submissionId = String((result as any)?.submission?.id ?? "")
    logger.info(
      `[auto-draft-payment-submission] run ${runId}: drafted submission ${submissionId} ` +
        `for design ${payout.design_id} (${payout.quantity} x ${payout.unit_amount} = ${payout.amount}) via ${source}`
    )
    return {
      drafted: true,
      reason: "drafted",
      submission_id: submissionId,
      source,
    }
  } catch (e: any) {
    // A guard refusing is the normal case, not an error worth paging on — the
    // design may already sit in an open submission raised by hand.
    logger.info(
      `[auto-draft-payment-submission] run ${runId}: no draft created — ${e?.message}`
    )
    return { drafted: false, reason: "refused", source }
  }
}

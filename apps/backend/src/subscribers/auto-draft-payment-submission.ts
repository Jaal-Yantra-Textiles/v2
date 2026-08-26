import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

import { createPaymentSubmissionWorkflow } from "../workflows/payment_submissions/create-payment-submission"
import { assessRunPayout } from "../workflows/production-runs/lib/run-payable"

/**
 * When a production run completes, pre-fill the partner's payment submission.
 *
 * Completion is the moment every fact needed to bill for the work exists: the
 * design, the partner, the ordered quantity, and the cost the partner just
 * typed into the completion form. Until now the partner had to then go to
 * Payment Submissions, find that design in a list of everything they've ever
 * been assigned, re-enter the same amount, and submit — so the money step
 * lagged the work step by however long that took, or never happened.
 *
 * This drafts it for them: one design-sourced item, amount = the run's payable
 * total, landing as **Draft** — visible, editable, and NOT yet a claim on
 * anyone. The partner still reviews and submits, so nothing is billed on their
 * behalf without their say-so. See the `status` / `require_design_status`
 * options on createPaymentSubmissionWorkflow for why a draft is allowed to skip
 * the design-status gate that a hand-made submission must pass.
 *
 * Deliberately best-effort: a failure here must never look like the completion
 * failed (completion has already committed by the time this event fires), so
 * every path logs and returns.
 */
export default async function autoDraftPaymentSubmissionHandler({
  event,
  container,
}: SubscriberArgs<{ id?: string; production_run_id?: string }>) {
  const runId = event.data?.production_run_id || event.data?.id
  if (!runId) {
    return
  }

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productionRunService = container.resolve("production_runs") as any

  let run: any = null
  try {
    run = await productionRunService.retrieveProductionRun(runId)
  } catch {
    return
  }

  const payout = assessRunPayout(run)
  if (!payout.eligible) {
    logger.info(
      `[auto-draft-payment-submission] run ${runId}: skipped (${payout.reason})`
    )
    return
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
        notes: `Drafted automatically when production run ${runId} completed. Review the amount and submit when you're ready.`,
        metadata: {
          auto_drafted: true,
          source: "production_run.completed",
          production_run_id: runId,
          cost_type: run?.cost_type ?? null,
          ordered_quantity: run?.quantity ?? null,
          partner_cost_estimate: run?.partner_cost_estimate ?? null,
          /** The total the two fields below are expected to reproduce. */
          payable_amount: payout.amount,
          // The rate the partner entered at completion, and how many units it
          // covers, rather than a single opaque total. The workflow multiplies
          // them, so the draft bills exactly `runPayableAmount` — and the line
          // item records the breakdown, so a partner querying the figure sees
          // "9 x 850" instead of a 7650 they have to take on trust.
          //
          // 🔴 Deliberately NOT `design_cost_overrides`. A total override sets
          // `unit_amount` to null (there is no recorded rate behind a typed
          // total), which would have thrown away the very breakdown this
          // subscriber is the one place that actually knows. #1554
          design_unit_amounts: { [payout.design_id]: payout.unit_amount },
          design_quantities: { [payout.design_id]: payout.quantity },
        },
      },
    })

    logger.info(
      `[auto-draft-payment-submission] run ${runId}: drafted submission ${
        (result as any)?.submission?.id
      } for design ${payout.design_id} (${payout.quantity} x ${
        payout.unit_amount
      } = ${payout.amount})`
    )
  } catch (e: any) {
    // The commonest "failure" is the design already sitting in an open
    // submission — that's the guard doing its job, not an error worth paging on.
    logger.info(
      `[auto-draft-payment-submission] run ${runId}: no draft created — ${e?.message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "production_run.completed",
}

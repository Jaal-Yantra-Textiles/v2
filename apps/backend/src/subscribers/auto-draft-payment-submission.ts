import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

import { autoDraftRunPayout } from "../workflows/payment_submissions/lib/auto-draft-run-payout"

/**
 * When a production run completes, pre-fill the partner's payment submission.
 *
 * Completion is the moment most of the facts needed to bill for the work exist:
 * the design, the partner, the ordered quantity, and the cost the partner just
 * typed into the completion form. Until this existed the partner had to then go
 * to Payment Submissions, find that design in a list of everything they have
 * ever been assigned, re-enter the same amount, and submit — so the money step
 * lagged the work step by however long that took, or never happened.
 *
 * ⚠️ Completion is not the moment they ALL exist. A run finished with no agreed
 * rate is skipped as `no_cost`, and for as long as this was the only trigger,
 * nothing looked at it again — the price could be recorded an hour later and no
 * draft would ever appear. The admin update route now makes the same attempt
 * when a completed run is priced; the behaviour lives in `autoDraftRunPayout`
 * so the two callers cannot drift into drafting different things.
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

  await autoDraftRunPayout(container, runId, "production_run.completed")
}

export const config: SubscriberConfig = {
  event: "production_run.completed",
}

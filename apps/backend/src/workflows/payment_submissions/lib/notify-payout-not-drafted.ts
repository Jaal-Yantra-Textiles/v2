import { Modules } from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/types"

/**
 * Somebody is told that a priced, completed run got no payout draft (#2433).
 *
 * `autoDraftRunPayout` decides a run IS payable — completed, priced, the
 * partner's, a real job — and then `createPaymentSubmissionWorkflow` refuses
 * it. Until now that produced one `logger.info` ("no draft created — …") in a
 * log nobody reads. Ksaman's runs sat in exactly that state on 2026-10-18: the
 * design was not linked to the partner, the guard said so, and the only reason
 * anyone noticed was that a payout was missing.
 *
 * The refusal is usually CORRECT — the guards exist to stop a wrong or double
 * payout — so this does not retry or force anything. It tells a person, on the
 * day the money stopped, with the guard's own words.
 *
 * 🔴 NEVER THROWS. This runs inside an event-bus handler after the completion
 * has committed. A notification module that is down must not make the
 * completion look like it failed.
 */
export type PayoutNotDraftedNotice = {
  runId: string
  partnerId: string
  designId: string
  /** What the draft would have been for, `quantity x unit_amount`. */
  amount: number
  /** The create workflow's refusal, verbatim. */
  refusal: string
  /** What triggered the attempt — completion, or a later pricing. */
  source: string
}

export const notifyPayoutNotDrafted = async (
  container: any,
  notice: PayoutNotDraftedNotice,
  logger?: { warn?: (m: string) => void }
): Promise<boolean> => {
  try {
    const notificationService = container.resolve(
      Modules.NOTIFICATION
    ) as INotificationModuleService

    await notificationService.createNotifications({
      to: "",
      channel: "feed",
      template: "admin-ui",
      data: {
        title: "⚠️ A finished, priced run got no payout",
        /*
         * What is true, why, and what to do — in that order. The guard's
         * message is the "why"; it already names the fix in most cases
         * ("Designs not assigned to this partner: …").
         */
        description:
          `Run ${notice.runId} (partner ${notice.partnerId}, design ${notice.designId}) is completed and priced at ${notice.amount}, ` +
          `but its payout draft was refused: ${notice.refusal}. ` +
          `Nothing will be paid for it until someone acts. Fix the cause (e.g. link the design to the partner) and re-price the run, ` +
          `or raise the payout by hand.`,
        metadata: {
          production_run_id: notice.runId,
          partner_id: notice.partnerId,
          design_id: notice.designId,
          amount: notice.amount,
          refusal: notice.refusal,
          source: notice.source,
          reason: "payout_draft_refused",
          action_required:
            "Fix the refusal and re-price the run, or create the payout by hand",
          severity: "warning",
          timestamp: new Date().toISOString(),
        },
      },
    })
    return true
  } catch (e: any) {
    /*
     * Logged at warn and named, so a silent notifier is itself visible. The
     * payout is still missing; only the telling failed.
     */
    logger?.warn?.(
      `[auto-draft-payment-submission] run ${notice.runId} got no payout draft and the notification could not be raised: ${
        e?.message || String(e)
      }`
    )
    return false
  }
}

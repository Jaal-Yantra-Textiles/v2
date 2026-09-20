import { Modules } from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/types"

/**
 * Somebody is told that a run is ready and cannot dispatch itself (#2202).
 *
 * `releaseRunIfReady` returns `no_templates` when every dependency is met and
 * no template selection exists — the cloth has arrived, the work could start,
 * and nothing will happen. Until now that produced one `logger.info` saying
 * "dispatch by hand", in a log nobody reads. The four Oshen runs sat in exactly
 * that state for weeks and the only reason anyone noticed was a question asked
 * by hand.
 *
 * A dispatch-defaults rule (also #2202) answers this ahead of time for the
 * kinds of job an operator has decided about. This is what happens for every
 * other kind: the run stays parked — which is correct, because dispatch
 * commissions a partner and must not be guessed — and a person is told, on the
 * day it became true rather than whenever someone next looks.
 *
 * 🔴 NEVER THROWS. This runs inside an event-bus handler, after a delivery has
 * been recorded and dependent runs released. A notification module that is
 * down must not make any of that look like it failed.
 */
export type DispatchByHandNotice = {
  runId: string
  /** What became met and released this run — an order id, or an upstream run. */
  releasedBy: string
  /** "inventory order" | "production run" — how to read `releasedBy`. */
  releasedByKind: "inventory order" | "production run"
}

export const notifyDispatchByHand = async (
  container: any,
  notice: DispatchByHandNotice,
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
        title: "⚠️ A run is ready but nobody chose how to dispatch it",
        /*
         * Says what is true and what to do, in that order. "Ready" is the
         * important word: this is not a failure and nothing is broken — the
         * work simply cannot start until someone picks the steps.
         */
        description:
          `Run ${notice.runId} is no longer waiting — its ${notice.releasedByKind} ${notice.releasedBy} is done — ` +
          `but no task templates were ever recorded for it, so it will NOT dispatch itself. ` +
          `Dispatch it from the admin (Production Run → Dispatch), or add a dispatch-defaults rule so runs like it go out on their own.`,
        metadata: {
          production_run_id: notice.runId,
          released_by: notice.releasedBy,
          released_by_kind: notice.releasedByKind,
          reason: "no_templates",
          action_required: "Choose task templates and dispatch, or add a dispatch-defaults policy rule",
          severity: "warning",
          timestamp: new Date().toISOString(),
        },
      },
    })
    return true
  } catch (e: any) {
    /*
     * Logged at warn and named, so a silent notifier is itself visible. The
     * run is still parked and still correct; only the telling failed.
     */
    logger?.warn?.(
      `[dispatch-by-hand] run ${notice.runId} needs a manual dispatch but the notification could not be raised: ${
        e?.message || String(e)
      }`
    )
    return false
  }
}

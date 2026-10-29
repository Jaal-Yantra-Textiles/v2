import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { BOT_SUPPRESSED_SEND_ID } from "./bot-recipients"
import { sendNotificationEmailWorkflow } from "../workflows/email/workflows/send-notification-email"

/**
 * Tell a buyer that something we sent them has been withdrawn: a design order
 * cancelled, or a quote revoked.
 *
 * Before this, both were silent. A revoked quote's link simply 404s and a
 * cancelled design order's link redirects to the shop, so the buyer found out
 * by clicking — or never, and wondered why we went quiet.
 *
 * 🔑 Default ON, with an explicit opt-out. The opt-out exists for the re-issue
 * case: cancelling a design order to send a corrected one means the buyer
 * gets the new link anyway, and a "cancelled" email arriving next to it reads
 * as "the deal is off". The caller decides; the default is to tell them.
 *
 * Never throws. The withdrawal is already recorded by the time this runs, and
 * a failed email must not make it look otherwise. The outcome is returned so
 * the operator can see whether the buyer was actually told.
 */

export const DESIGN_ORDER_CANCELLED_TEMPLATE = "design-order-cancelled"
export const QUOTE_REVOKED_TEMPLATE = "quote-revoked"

export type BuyerNotice = {
  /** True only when a provider accepted a real message. */
  sent: boolean
  /** Who it was addressed to, whether or not it went. */
  to: string | null
  /** Why it did not go, in plain words. Null on success. */
  reason: string | null
}

/**
 * PURE: should we email, and to whom? `notify` is the caller's flag as it
 * arrived on the request — only an explicit `false` turns the notice off, so
 * a missing field never silently suppresses it.
 */
export function decideBuyerNotice(input: {
  notify: unknown
  to: string | null | undefined
}): { send: true; to: string } | { send: false; reason: string; to: string | null } {
  const to = String(input.to ?? "").trim() || null
  if (input.notify === false) {
    return { send: false, to, reason: "Not sent: notify_buyer was false." }
  }
  if (!to) {
    return {
      send: false,
      to: null,
      reason: "Not sent: there is no buyer email on record. Tell the buyer yourself.",
    }
  }
  return { send: true, to }
}

export async function notifyBuyerOfWithdrawal(
  scope: any,
  input: {
    notify: unknown
    to: string | null | undefined
    template: string
    data: Record<string, any>
  }
): Promise<BuyerNotice> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const decision = decideBuyerNotice({ notify: input.notify, to: input.to })
  if (!decision.send) {
    return { sent: false, to: decision.to, reason: decision.reason }
  }

  try {
    const { result } = await sendNotificationEmailWorkflow(scope).run({
      input: {
        to: decision.to,
        template: input.template,
        data: { ...input.data, current_year: `${new Date().getFullYear()}` },
      },
    })
    if ((result as any)?.id === BOT_SUPPRESSED_SEND_ID) {
      return {
        sent: false,
        to: decision.to,
        reason: "Not sent: the address is a known crawler address and mail to it is suppressed.",
      }
    }
    logger?.info?.(`[buyer-notice] ${input.template} emailed to ${decision.to}`)
    return { sent: true, to: decision.to, reason: null }
  } catch (e: any) {
    const reason = `Not sent: ${e?.message ?? String(e)}`
    logger?.error?.(`[buyer-notice] ${input.template} to ${decision.to} failed: ${reason}`)
    return { sent: false, to: decision.to, reason }
  }
}

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { BOT_SUPPRESSED_SEND_ID } from "../../lib/bot-recipients"
import { sendDesignOrderCreatedEmailWorkflow } from "../email/workflows/send-design-order-created-email"

/**
 * Send a freshly created design order's link to its buyer, and say honestly
 * whether it went.
 *
 * ## Why this never throws
 *
 * 🔴 The create route has already committed a cart with real prices on it. A
 * delivery failure that became a 500 would destroy the response — and with it
 * the only place the operator is shown the checkout link — for an order that
 * exists regardless. So every failure is a returned verdict, logged at error,
 * and the panel tells the human to send the link by hand. Exactly the contract
 * `deliverQuoteEmail` follows, and for the same reason.
 *
 * ## The suppression trap
 *
 * Every provider silently returns `BOT_SUPPRESSED_SEND_ID` for a known crawler
 * address without mailing anything (#1333). Reporting that as delivered would
 * tell the operator the buyer has their link when nothing was sent, so it is
 * treated as a failure here — "we chose not to mail this" and "the buyer has
 * their link" must not collapse into the same true.
 */
export type DesignOrderEmailDelivery = {
  /** True only when a provider accepted a real message. */
  sent: boolean
  /** The address it was addressed to, whether or not it went. */
  to: string | null
  /** Why it did not go. Null on success. Shown to a human, so plain words. */
  reason: string | null
}

export const deliverDesignOrderEmail = async (
  scope: any,
  input: {
    cart: any
    checkoutUrl: string | null
    paymentLink?: string | null
  }
): Promise<DesignOrderEmailDelivery> => {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const cart = input.cart
  const to = String(cart?.email ?? "").trim() || null

  const fail = (reason: string): DesignOrderEmailDelivery => {
    logger?.error?.(
      `[design-order] email NOT delivered cart=${cart?.id} to=${to ?? "—"}: ${reason}`
    )
    return { sent: false, to, reason }
  }

  /**
   * A design order with no buyer attached is ORDINARY here (#1817) — the
   * customer is attached later, or collected at checkout. So this is logged as
   * information, not as an error: there is nobody to mail yet, and that is not
   * a fault to report to anyone.
   */
  if (!to) {
    logger?.info?.(
      `[design-order] no buyer email on cart=${cart?.id}; nothing to send yet.`
    )
    return {
      sent: false,
      to: null,
      reason:
        "No buyer is attached yet, so there was nobody to email. Attach a customer from the order, or share the link yourself.",
    }
  }

  /**
   * An email without the link is worse than no email: it tells the buyer an
   * order exists and gives them no way to pay for it.
   */
  if (!input.checkoutUrl) {
    return fail(
      "there is no checkout link to send — we could not work out which storefront this order belongs to."
    )
  }

  try {
    const { result } = await sendDesignOrderCreatedEmailWorkflow(scope).run({
      input: {
        to,
        data: {
          cart_id: cart?.id ?? null,
          checkout_url: input.checkoutUrl,
          payment_link: input.paymentLink ?? null,
          currency_code: cart?.currency_code ?? null,
          total: cart?.total ?? null,
          item_count: Array.isArray(cart?.items) ? cart.items.length : null,
          current_year: `${new Date().getFullYear()}`,
        },
      },
    })

    if ((result as any)?.id === BOT_SUPPRESSED_SEND_ID) {
      return fail(
        "the recipient is a known crawler address and mail to it is suppressed."
      )
    }

    logger?.info?.(`[design-order] link emailed cart=${cart?.id} to=${to}`)
    return { sent: true, to, reason: null }
  } catch (e: any) {
    /**
     * The commonest cause is a missing `design-order-created` template row —
     * `fetchEmailTemplateStep` throws rather than sending a generic shell. The
     * message is surfaced as-is so the operator can see which it was.
     */
    return fail(e?.message ?? String(e))
  }
}

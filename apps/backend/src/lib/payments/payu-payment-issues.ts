import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Money PayU took that we could not apply to an order (#2572).
 *
 * Before the UPI intent, a design-order buyer could only pay through a link we
 * could switch off. An intent cannot be switched off, and the link and the
 * intent are both payable for the same cart, so three things can now happen
 * that used to be impossible or invisible:
 *
 * - **short**: an old QR paid after a reprice/amend — PayU confirms success but
 *   for less than is due now. The webhook refuses to complete the cart, which
 *   is right, but the buyer's money is with us and no order says so.
 * - **over**: an old QR paid after the price went DOWN — the cart completes,
 *   and the buyer paid more than owed.
 * - **extra**: a payment for a cart that is already completed by a DIFFERENT
 *   payment (the link and the intent both paid, or checkout then QR).
 *
 * Each one is a refund or a reconciliation a human must do. So each is logged
 * at error, written to the cart (`metadata.payu_payment_issues`, so it can be
 * found later), and posted to the admin feed. Never throws.
 */

export const PAYU_PAYMENT_ISSUES_KEY = "payu_payment_issues"
/** The txnid whose payment completed this cart through the PayU webhook. */
export const PAYU_COMPLETED_TXNID_KEY = "payu_completed_txnid"
/**
 * Txnids that set out to complete this cart, written BEFORE completion. PayU
 * re-delivers one payment's webhook ~1 s apart; without the claim the second
 * delivery saw a completed cart with no stamp yet and called it a second
 * payment (false alarm on the live test, 2026-11-22).
 */
export const PAYU_CLAIMED_TXNIDS_KEY = "payu_claimed_txnids"

export type PayuPaymentIssueKind = "short" | "over" | "extra"

export type PayuPaymentIssue = {
  kind: PayuPaymentIssueKind
  txnid: string
  mihpayid: string | null
  /** What PayU says was paid. */
  paid: number | null
  /** What was due when the payment landed. */
  due: number | null
  /**
   * #2645 — set when the cart carries a DEPOSIT schedule and `due` is that
   * deposit: the cart's full total. A full payment on a deposit cart is an old
   * full-total link/QR paid after the deposit was set, and the order then
   * records only the deposit as paid — so the balance would be asked for again.
   */
  deposit_cart_total?: number | null
  at: string
}

const say = (i: PayuPaymentIssue, cartId: string): string => {
  const rs = (n: number | null) => (n === null ? "?" : `₹${n.toFixed(2)}`)
  if (i.kind === "over" && i.deposit_cart_total != null)
    return (
      `Cart ${cartId} is a DEPOSIT order (deposit ${rs(i.due)} of ${rs(i.deposit_cart_total)}) but PayU took ${rs(i.paid)} ` +
      `(txn ${i.txnid}) — an old link or QR paid after the deposit was set. The order records only the deposit as paid, ` +
      `so its balance would be asked for AGAIN. Do NOT raise the balance: refund ${rs(
        i.paid === null || i.due === null ? null : Math.round((i.paid - i.due) * 100) / 100
      )} (the balance then stays due later), or reconcile the order as paid in full.`
    )
  if (i.kind === "short")
    return `PayU took ${rs(i.paid)} (txn ${i.txnid}) for cart ${cartId}, but ${rs(i.due)} is due, so no order was completed. Refund it or take the difference.`
  if (i.kind === "over")
    return `Cart ${cartId} completed on a PayU payment of ${rs(i.paid)} (txn ${i.txnid}) when only ${rs(i.due)} was due. Refund the difference.`
  return `PayU took ${rs(i.paid)} (txn ${i.txnid}) for cart ${cartId}, which was already paid and completed. This is a second payment — refund it.`
}

/** Pure: should a webhook payment on an already-completed cart be flagged? */
export const isExtraPayment = (input: {
  completedAt: unknown
  /** Txnids already applied to this cart (the stamp, the payment sessions). */
  knownTxnids: unknown[]
  txnid: string
}): boolean =>
  Boolean(input.completedAt) &&
  // A repeat webhook for the payment that completed the cart is not extra.
  !input.knownTxnids.some((t) => t !== null && t !== undefined && String(t) === input.txnid)

export const recordPayuPaymentIssue = async (
  scope: any,
  cartId: string,
  issue: Omit<PayuPaymentIssue, "at">
): Promise<void> => {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const full: PayuPaymentIssue = { ...issue, at: new Date().toISOString() }
  const message = say(full, cartId)
  logger?.error?.(`[PayU payment issue] ${message}`)

  try {
    const cartService: any = scope.resolve(Modules.CART)
    const [cart] = await cartService.listCarts({ id: cartId }, { select: ["id", "metadata"] })
    const existing: PayuPaymentIssue[] = Array.isArray(cart?.metadata?.[PAYU_PAYMENT_ISSUES_KEY])
      ? cart.metadata[PAYU_PAYMENT_ISSUES_KEY]
      : []
    // A retried webhook must not stack the same issue twice.
    if (!existing.some((e) => e.txnid === full.txnid && e.kind === full.kind)) {
      await cartService.updateCarts(cartId, {
        metadata: { ...(cart?.metadata ?? {}), [PAYU_PAYMENT_ISSUES_KEY]: [...existing, full] },
      })
    }
  } catch (e: any) {
    logger?.error?.(`[PayU payment issue] could not record on cart ${cartId}: ${e?.message ?? e}`)
  }

  try {
    const notifications: any = scope.resolve(Modules.NOTIFICATION)
    await notifications.createNotifications([
      {
        to: "",
        channel: "feed",
        template: "admin-ui",
        data: { title: "PayU payment needs a human", description: message },
      },
    ])
  } catch (e: any) {
    logger?.warn?.(`[PayU payment issue] admin feed post failed: ${e?.message ?? e}`)
  }
}

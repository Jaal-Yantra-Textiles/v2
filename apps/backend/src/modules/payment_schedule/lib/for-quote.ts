import { PAYMENT_SCHEDULE_MODULE } from ".."

/**
 * The deposit/balance schedule for a quote, in the shape a detail page needs.
 *
 * One helper for both surfaces rather than the same six lines twice: the admin
 * and partner quote pages must never disagree about what a buyer has paid, and
 * two copies of a read is how they start to.
 *
 * Returns null for a quote nobody has accepted — which is most of them, and is
 * not a failure. Never throws: a quote page that 500s because the ledger read
 * failed is worse than one that shows the quote without it.
 */
export const loadScheduleForQuote = async (
  scope: any,
  quote: { accepted_cart_id?: string | null } | null | undefined
) => {
  if (!quote?.accepted_cart_id) {
    return null
  }
  try {
    const schedules: any = scope.resolve(PAYMENT_SCHEDULE_MODULE)
    return await schedules.findByCartId(quote.accepted_cart_id)
  } catch {
    return null
  }
}

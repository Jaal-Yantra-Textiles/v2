import { splitDeposit } from "../../payment_schedule/lib/split"

/**
 * What the buyer needs to know before they press Accept (#1439 S11).
 *
 * ## Why the page is told it CANNOT accept, rather than finding out on click
 *
 * 🔴 Acceptance needs a `quoted_shipping_option_id`: the accepted cart's
 * freight option is built in that option's service zone, so the number the
 * buyer pays and the number they were quoted come from the same lane. A quote
 * whose freight was named by hand on a lane that rated NOTHING has no option to
 * carry over — it can be quoted and cannot be accepted. That is a real state
 * today on exactly the cross-border lanes where the carrier answers "no
 * serviceable couriers".
 *
 * A button that 500s on click is how a buyer decides the supplier is not
 * serious. The refusal is computed here and rendered as a reason.
 *
 * ## The amount shown is the GROSS total
 *
 * 🔑 Not the landed total. The deposit is a share of what the cart will
 * actually charge, and the cart charges tax. Quoting a deposit off the
 * pre-tax figure would ask for less than the schedule then records, and the
 * gap would surface as a balance nobody agreed.
 */

export type QuoteAcceptance = {
  /** True once the buyer has accepted; the cart already exists. */
  accepted: boolean
  accepted_cart_id: string | null
  /** False ⇒ render `blocked_reason` instead of a button. */
  can_accept: boolean
  /** Written for the buyer, not for a log. Null when `can_accept`. */
  blocked_reason: string | null
  currency_code: string
  /** What the cart will charge in total, tax included. */
  total_due: number | null
  deposit_pct: number
  deposit_amount: number | null
  balance_amount: number | null
}

/** PURE. `unusableReason` is the same verdict the page header already uses. */
export function composeQuoteAcceptance(input: {
  quote: any
  /** The gross total the cart will charge — live if we have it, else frozen. */
  gross_total: number | null | undefined
  /** Non-null when the quote is revoked or expired. */
  unusable_reason?: string | null
}): QuoteAcceptance {
  const q = input.quote ?? {}
  const accepted = Boolean(q.accepted_cart_id)

  const total =
    input.gross_total === null || input.gross_total === undefined
      ? null
      : Number(input.gross_total)

  const split = splitDeposit(total ?? 0, q.deposit_pct)

  const blocked = (() => {
    if (accepted) return null
    if (input.unusable_reason) {
      return "This quote is no longer open. Ask for a fresh one and it will be priced again."
    }
    if (!q.quoted_shipping_option_id) {
      // The honest version. Not "something went wrong".
      return "Freight on this lane was quoted by hand, so the order cannot be placed online yet. Reply to this quote and we will raise it for you."
    }
    if (total === null || !Number.isFinite(total) || total <= 0) {
      return "This quote has no total to charge. Ask for a fresh one."
    }
    return null
  })()

  return {
    accepted,
    accepted_cart_id: q.accepted_cart_id ?? null,
    can_accept: !accepted && !blocked,
    blocked_reason: blocked,
    currency_code: q.currency_code ?? "",
    total_due: total,
    deposit_pct: split.deposit_pct,
    deposit_amount: total === null ? null : split.deposit_amount,
    balance_amount: total === null ? null : split.balance_amount,
  }
}

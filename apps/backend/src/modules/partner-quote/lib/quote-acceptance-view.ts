import { splitDeposit } from "../../payment_schedule/lib/split"

/**
 * What the buyer needs to know before they press Accept (#1439 S11).
 *
 * ## Why the page is told it CANNOT accept, rather than finding out on click
 *
 * 🔴 Acceptance needs a `quoted_shipping_option_id`: the accepted cart's
 * freight option is built in that option's SERVICE ZONE, so the number the
 * buyer pays and the number they were quoted come from the same lane. With no
 * option there is no zone, and therefore no way to put freight on the cart at
 * all. The alternatives are worse — a cart with no freight line (the buyer pays
 * for goods only and we absorb the shipping), or freight attached to no real
 * lane.
 *
 * A button that 500s on click is how a buyer decides the supplier is not
 * serious. The refusal is computed here and rendered as a reason.
 *
 * ## ⚠️ Hand-typed freight is NOT what blocks this
 *
 * The wording here used to say it was, and that was wrong twice over.
 *
 * An override deliberately PRESERVES the underlying option
 * (`shipping_option_id: chosen?.shipping_option_id` in `build-quote-view`), so
 * a typed amount on a lane a carrier can rate accepts perfectly well — proved
 * by minting one: `freight_override_amount: 777` on a Mumbai lane accepted, and
 * the cart carried it. The id is null only when NOTHING was quotable for the
 * destination.
 *
 * So the old copy blamed the partner's typed rate for a gap in shipping
 * configuration — and a partner who believes it stops typing rates, which is
 * the exact opposite of what #1439 S12 added them for.
 *
 * 🔑 The honest statement is about the DESTINATION, not about who named the
 * number.
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
      /**
       * About the destination, not about the freight's provenance — see the
       * note above. Says what is true, what happens next, and whose move it is,
       * without asking the buyer to care why.
       */
      return "We cannot take this order online for your destination yet — there is no online delivery set up for this route. Reply to this quote and we will arrange it for you."
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

import { model } from "@medusajs/framework/utils"

/**
 * What a buyer still owes, and how it was split (#1439 S11, #959 Slice C).
 *
 * ## Why this is its own module and not columns on the quote
 *
 * Two features need the same thing. A B2B quote is accepted and takes a
 * deposit; a made-to-order catalog variant is bought and takes a deposit. #959
 * says in as many words: do not build a parallel deposit mechanism. So the
 * schedule is keyed on the ORDER (and the cart it came from), and records where
 * it came from in `source_type`/`source_id` — a quote today, a catalog MTO line
 * tomorrow. Nothing here knows what a quote is.
 *
 * ## Why the split is two charges rather than one held authorisation
 *
 * 🔴 This was designed against the Stripe docs, not against intuition, and the
 * intuition was wrong:
 *
 * - An online card authorisation is valid **7 days** (5 for a Visa MIT). A
 *   made-to-order lead time is not 7 days, so a held auth cannot be the balance.
 * - **Extended authorisation** reaches 30 days but is an IC+ pricing feature,
 *   costs an extra 0.08%/txn outside hotel/rental/cruise categories, and the
 *   networks intend it for "you don't know the final amount" — not for us.
 * - **Multicapture** (up to 50 non-final captures) is also IC+, and Stripe's own
 *   compliance note says some networks **don't permit it for instalment or
 *   deposit workflows**. Which is exactly this workflow.
 * - Stripe's capture docs name the alternative outright: "If you partially
 *   capture a payment, you can't perform another capture for the difference.
 *   (Instead, consider saving the customer's payment method details for later
 *   and creating future payments as needed.)"
 *
 * So both rails are two charges: deposit now, balance later — Stripe via a
 * saved payment method charged off-session, PayU via a second payment link. The
 * rails differ only in the adapter, which is why `rail` is a column and not a
 * fork in the schema.
 *
 * ## Money lives here, not in metadata
 *
 * Every amount is a `bigNumber` in `currency_code`'s major units, matching how
 * the quote freezes its own totals. The repo rule against critical data in
 * metadata applies with full force: "how much has this buyer actually paid" is
 * the last thing that should live in a json blob nobody can filter on — see
 * what that cost the quote's own buyer ids in #1440.
 */
const PaymentSchedule = model.define("payment_schedule", {
  id: model.id().primaryKey(),

  // ===== What this schedule is for =======================================
  /**
   * The cart the schedule was created against. Present from the moment of
   * acceptance, i.e. BEFORE there is an order — the deposit is what turns the
   * cart into one, so a schedule keyed only on `order_id` could not exist at
   * the point it is needed.
   */
  cart_id: model.text().nullable(),
  /** Set when the cart completes. Null while the deposit is still unpaid. */
  order_id: model.text().nullable(),
  /**
   * Provenance. `quote` — a partner quote was accepted (#1439 S11).
   * `catalog_mto` — a made-to-order catalog variant was bought (#959 Slice C).
   * `manual` — an operator raised it by hand.
   */
  source_type: model.enum(["quote", "catalog_mto", "manual"]).default("quote"),
  /** The quote id, the variant id, whatever `source_type` says it is. */
  source_id: model.text().nullable(),

  // ===== The split =======================================================
  currency_code: model.text(),
  /**
   * The whole amount owed, in major units — goods + freight + tax + any DDP
   * charges. `deposit_amount + balance_amount` must equal this, and the
   * service enforces that rather than trusting the caller's arithmetic: a
   * rounding split that quietly loses a rupee is a support ticket months later.
   */
  total_due: model.bigNumber(),
  /**
   * The percentage the deposit was computed from, frozen. Kept beside the
   * amount because "30% of what, when?" is the question anyone auditing a part
   * payment asks, and a percentage recomputed from two rounded amounts answers
   * it wrong.
   */
  deposit_pct: model.number(),
  deposit_amount: model.bigNumber(),
  /**
   * `waived` is deliberate and distinct from `paid`: a partner may take a
   * trusted buyer on account, and recording that as "paid" would put money in
   * the ledger that nobody received.
   */
  deposit_status: model
    .enum(["pending", "paid", "failed", "waived"])
    .default("pending"),
  deposit_paid_at: model.dateTime().nullable(),
  /**
   * The rail's own identifier for the deposit charge — a PayU `txnid`, a Stripe
   * PaymentIntent id. This is what reconciliation joins on when the carrier of
   * truth is the gateway dashboard rather than us.
   */
  deposit_ref: model.text().nullable(),

  balance_amount: model.bigNumber(),
  /**
   * `not_due` is the starting state, and it is not the same as `due`. The
   * balance becomes `due` on a production/delivery event; a balance that reads
   * `due` from the moment of acceptance would have us chasing a buyer for money
   * against goods that have not been made.
   */
  balance_status: model
    .enum(["not_due", "due", "paid", "failed", "waived"])
    .default("not_due"),
  balance_paid_at: model.dateTime().nullable(),
  /** The PayU payment link / Stripe PaymentIntent minted for the balance. */
  balance_link_ref: model.text().nullable(),
  /** When the balance was raised, i.e. when the event fired. */
  balance_due_at: model.dateTime().nullable(),

  /**
   * Which rail took, or will take, the money.
   *
   * `manual` covers an offline settlement (bank transfer against an invoice),
   * which for B2B is not an edge case — it is how a good share of trade
   * actually pays, and pretending otherwise would push operators into marking
   * PayU rows paid that PayU never saw.
   */
  rail: model.enum(["payu", "stripe", "manual"]).default("manual"),

  metadata: model.json().nullable(),
})

export default PaymentSchedule

import { defineLink } from "@medusajs/framework/utils"
import PaymentSubmissionsModule from "../modules/payment_submissions"
import InternalPaymentModule from "../modules/internal_payments"

/**
 * PaymentSubmission <-> InternalPayments — which payouts a payment pays.
 *
 * 🔴 MANY-TO-MANY, on purpose (#2523). With `isList` only on the payments side
 * this was one-to-many: Medusa's link service refuses a second payout for the
 * same payment ("Cannot create multiple links between 'payment_submissions'
 * and 'internal_payments'"). The ledger fold had allocated one payment across
 * several payouts since #1712, but no route could ever write that shape — so a
 * founder paying 25,000 "against all three bills" could only point it at one.
 *
 * The cardinality lives in the link SERVICE, not the table: the pivot table and
 * its name are unchanged, and `isList` on both sides only lifts the check.
 * How much of the payment each payout takes is `payment_allocation` (#2523);
 * without a row there, the fold splits oldest-payout-first.
 */
export default defineLink(
  {
    linkable: PaymentSubmissionsModule.linkable.paymentSubmission,
    isList: true,
  },
  {
    linkable: InternalPaymentModule.linkable.internalPayments,
    isList: true,
    field: "payments",
  }
)

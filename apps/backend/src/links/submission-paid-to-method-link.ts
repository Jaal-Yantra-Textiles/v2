import { defineLink } from "@medusajs/framework/utils"
import PaymentSubmissionsModule from "../modules/payment_submissions"
import InternalPaymentModule from "../modules/internal_payments"

/**
 * PaymentSubmission -> the payment METHOD it was paid to.
 *
 * Replaces `internal_payments.paid_to_id` on the approval path (#1636). The
 * referent is unchanged — an `internal_payment_details` row, i.e. a bank/wallet
 * record, not a payment record — so the dependency this preserves is the
 * correct one.
 *
 * 🔴 The explicit `database.table` is load-bearing, not cosmetic.
 *
 * Medusa derives a link table's name as
 * `<moduleA>_<entityA>_<moduleB>_<entityB>`. For this pair that is
 *
 *   payment_submissions_payment_submission_internal_payments_internal_payment_details
 *
 * — 80 characters, against Postgres's 63-byte identifier limit. Its sibling
 * `submission-payment-link.ts` derives to 73 characters and its table exists in
 * NEITHER the local nor the production schema, while every link table that did
 * materialise here is 58 characters or shorter. That is the best explanation
 * anyone has for why `query.graph` on that link returns rows carrying no
 * `payments` key at all, under either spelling of the entity.
 *
 * Do not remove the override to "tidy up". Verify with:
 *   \dt *paid_to*
 *
 * ## 🔴 `isList` on the SUBMISSION side is load-bearing too
 *
 * One bank account receives MANY payouts. Without `isList: true` here, neither
 * side of the link is a list, and Medusa validates uniqueness on BOTH foreign
 * keys — `$or: [payment_submission_id, internal_payment_details_id]`
 * (`@medusajs/modules-sdk` `Link.create`). The first approval to an account
 * succeeds and **every later payout to that same account is refused** with
 *
 *   Cannot create multiple links between 'payment_submissions' and 'internal_payments'
 *
 * It read as a 400 on the review route with no mention of a bank account, so it
 * looked like a validation problem with the submission being approved rather
 * than a fact about one that had already been paid.
 *
 * `isList` marks the side that may be MANY: a payment method has many
 * submissions. The method side stays singular on purpose — a submission is paid
 * to exactly one account, and that is still enforced (Medusa then checks only
 * that no OTHER method is linked to this submission).
 *
 * The table is unchanged: its primary key is already the composite
 * `(payment_submission_id, internal_payment_details_id)`, so many-to-one was
 * always expressible in the schema. Only the application-level uniqueness check
 * was wrong, which is why no migration is needed and why nothing failed until a
 * partner was paid a second time.
 */
export default defineLink(
  {
    linkable: PaymentSubmissionsModule.linkable.paymentSubmission,
    isList: true,
  },
  {
    linkable: InternalPaymentModule.linkable.internalPaymentDetails,
    field: "paid_to",
  },
  {
    database: { table: "payment_submission_paid_to_method" },
  }
)

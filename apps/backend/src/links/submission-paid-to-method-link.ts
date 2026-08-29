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
 */
export default defineLink(
  PaymentSubmissionsModule.linkable.paymentSubmission,
  {
    linkable: InternalPaymentModule.linkable.internalPaymentDetails,
    field: "paid_to",
  },
  {
    database: { table: "payment_submission_paid_to_method" },
  }
)

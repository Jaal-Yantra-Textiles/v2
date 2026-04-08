import { defineLink } from "@medusajs/framework/utils"
import PaymentSubmissionsModule from "../modules/payment_submissions"
import InternalPaymentModule from "../modules/internal_payments"

// PaymentSubmission -> InternalPayments (one submission can produce payments)
export default defineLink(
  PaymentSubmissionsModule.linkable.paymentSubmission,
  {
    linkable: InternalPaymentModule.linkable.internalPayments,
    isList: true,
    field: "payments",
  }
)

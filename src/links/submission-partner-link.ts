import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import PaymentSubmissionsModule from "../modules/payment_submissions"

// Partner -> PaymentSubmissions (many submissions per partner)
export default defineLink(
  PartnerModule.linkable.partner,
  {
    linkable: PaymentSubmissionsModule.linkable.paymentSubmission,
    isList: true,
    field: "payment_submissions",
  }
)

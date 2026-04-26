import { defineLink } from "@medusajs/framework/utils"
import PaymentSubmissionsModule from "../modules/payment_submissions"
import DesignModule from "../modules/designs"

// PaymentSubmission <-> Design (many:many)
export default defineLink(
  {
    linkable: PaymentSubmissionsModule.linkable.paymentSubmission,
    isList: true,
  },
  {
    linkable: DesignModule.linkable.design,
    isList: true,
  }
)

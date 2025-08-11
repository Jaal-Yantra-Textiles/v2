import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import InternalPaymentModule from "../modules/internal_payments"

// Partner -> InternalPayments (many payments per partner)
export default defineLink(
  PartnerModule.linkable.partner,
  {
    linkable: InternalPaymentModule.linkable.internalPayments,
    isList: true,
    field: "payments",
  }
)

import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import InternalPaymentModule from "../modules/internal_payments"

export default defineLink(
  { linkable: PartnerModule.linkable.partner, isList: true, field: "payment_methods" },
  { linkable: InternalPaymentModule.linkable.internalPaymentDetails, isList: true, field: "partners" }
)

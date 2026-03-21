import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import PaymentModule from "@medusajs/medusa/payment"

export default defineLink(
  {
    linkable: PartnerModule.linkable.partner,
    isList: true,
  },
  {
    linkable: PaymentModule.linkable.refundReason,
    isList: true,
  }
)

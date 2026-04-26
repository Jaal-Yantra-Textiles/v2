import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import OrderModule from "@medusajs/medusa/order"

export default defineLink(
  {
    linkable: PartnerModule.linkable.partner,
    isList: true,
  },
  {
    linkable: OrderModule.linkable.returnReason,
    isList: true,
  }
)

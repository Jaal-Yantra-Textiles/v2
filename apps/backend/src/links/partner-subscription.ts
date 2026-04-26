import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import PartnerPlanModule from "../modules/partner-plan"

export default defineLink(
  PartnerModule.linkable.partner,
  {
    linkable: PartnerPlanModule.linkable.partnerSubscription,
    isList: true,
    field: "subscriptions",
  }
)

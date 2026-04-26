import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import RegionModule from "@medusajs/medusa/region"

export default defineLink(
  {
    linkable: PartnerModule.linkable.partner,
    isList: true,
  },
  {
    linkable: RegionModule.linkable.region,
    isList: true,
  }
)

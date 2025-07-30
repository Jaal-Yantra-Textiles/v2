
import DesignModule from "../modules/designs"
import PartnerModule from "../modules/partner"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  DesignModule.linkable.design,
  { linkable: PartnerModule.linkable.partner, isList: true }
)
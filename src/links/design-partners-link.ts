
import DesignModule from "../modules/designs"
import PartnerModule from "../modules/partner"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  { linkable: DesignModule.linkable.design , isList: true },
  { linkable: PartnerModule.linkable.partner, isList: true }
)
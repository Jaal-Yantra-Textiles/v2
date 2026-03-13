import PartnerModule from "../modules/partner"
import AgreementModule from "../modules/agreements"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  { linkable: PartnerModule.linkable.partner, isList: true, filterable: ["id", "name", "handle", "status"] },
  { linkable: AgreementModule.linkable.agreement, isList: true, filterable: ["id", "status", "title"] }
)

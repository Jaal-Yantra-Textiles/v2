import AgreementModule from "../modules/agreements"
import AgreementResponseModule from "../modules/agreement-responses"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  { linkable: AgreementModule.linkable.agreement, isList: true },
  { linkable: AgreementResponseModule.linkable.agreementResponse, isList: true, filterable: ["id", "agreement_id", "status", "agreed"] }
)

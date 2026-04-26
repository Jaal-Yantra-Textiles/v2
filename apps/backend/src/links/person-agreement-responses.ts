import PersonModule from "../modules/person"
import AgreementResponseModule from "../modules/agreement-responses"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  { linkable: PersonModule.linkable.person, isList: true, filterable: ["id", "name"] },
  { linkable: AgreementResponseModule.linkable.agreementResponse, isList: true, filterable: ["id", "agreement_id", "status", "agreed"] }
)

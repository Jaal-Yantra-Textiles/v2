import PersonModule from "../modules/person"
import AgreementModule from "../modules/agreements"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  { linkable: PersonModule.linkable.person, isList: true, filterable: ["id", "name"] },
  { linkable: AgreementModule.linkable.agreement, isList: true, field: 'agreements', filterable: ["id", "title", "status"] }
)
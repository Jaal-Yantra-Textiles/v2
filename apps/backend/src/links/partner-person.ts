import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import PersonModule from "../modules/person"

export default defineLink(
    PartnerModule.linkable.partner,
    {
        linkable: PersonModule.linkable.person,
        isList: true,
        field: 'people'
    }
)

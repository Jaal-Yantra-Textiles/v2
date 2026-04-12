import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import PersonTypeModule from "../modules/persontype"

export default defineLink(
    PartnerModule.linkable.partner,
    {
        linkable: PersonTypeModule.linkable.personType,
        isList: true,
        field: 'person_types'
    }
)

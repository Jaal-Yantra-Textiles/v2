import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import PersonTypeModule from "../modules/persontype"

// Many-to-many: a person type is a category ("Model", "Tailor", "Weaver") that
// any number of partners share. With the partner side single, a type could
// belong to ONE partner and tagging a second answered 400 "Cannot create
// multiple links between 'partner' and 'person_type'" (#2249, prod 2026-09-24).
export default defineLink(
    { linkable: PartnerModule.linkable.partner, isList: true },
    {
        linkable: PersonTypeModule.linkable.personType,
        isList: true,
        field: 'person_types'
    }
)

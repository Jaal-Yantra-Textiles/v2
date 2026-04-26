import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import StoreModule from "@medusajs/medusa/store"

// Link a Partner to one Store (one-to-one)
defineLink(
  PartnerModule.linkable.partner,
  { linkable: StoreModule.linkable.store, isList: true , field: 'stores'}
)

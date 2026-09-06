import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import StoreModule from "@medusajs/medusa/store"

/**
 * Link a Partner to its Store(s).
 *
 * 🔴 EXPORTED, and that matters. `defineLink` registers the link as an import
 * side effect, so this file worked without an export — but nothing could reach
 * its `entryPoint`, which is the only safe way to READ a link. A `query.graph`
 * hop from an entity to a linked field can come back with no key at all rather
 * than an error, and an empty result is indistinguishable from "this partner
 * has no store". Every other link file here exports; this one was the outlier.
 */
export default defineLink(
  PartnerModule.linkable.partner,
  { linkable: StoreModule.linkable.store, isList: true , field: 'stores'}
)

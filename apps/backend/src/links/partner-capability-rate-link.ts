import { defineLink } from "@medusajs/framework/utils"

import PartnerModule from "../modules/partner"
import PartnerCapabilityModule from "../modules/partner_capability"

/**
 * Partner ↔ capability rate (#2596), for the index: a search for a technique
 * returns each partner's rate band beside their evidence.
 *
 * 🔴 The index lags writes. A FIRM quote must re-read rates from the module,
 * never from an index result.
 */
export default defineLink(
  {
    linkable: PartnerModule.linkable.partner,
    filterable: ["id", "name", "handle", "status"],
  },
  {
    linkable: PartnerCapabilityModule.linkable.partnerCapabilityRate,
    isList: true,
    filterable: ["id", "technique", "unit", "source", "status"],
  }
)

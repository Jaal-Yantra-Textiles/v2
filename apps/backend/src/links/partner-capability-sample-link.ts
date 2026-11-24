import { defineLink } from "@medusajs/framework/utils"

import PartnerModule from "../modules/partner"
import PartnerCapabilityModule from "../modules/partner_capability"

/**
 * Partner ↔ capability sample (#2596). The sample still carries `partner_id`;
 * this link exists so Medusa's index engine can flatten partners and their
 * evidence into one search — "who does block print on cotton?" in one
 * `query.index` call, with the sample's own words searchable through `q`.
 *
 * Filters on a linked sample hold on the SAME sample (measured in the
 * spike: "hand painting" + "wool" does not match a partner who paints on
 * cotton and embroiders wool).
 */
export default defineLink(
  {
    linkable: PartnerModule.linkable.partner,
    filterable: ["id", "name", "handle", "status"],
  },
  {
    linkable: PartnerCapabilityModule.linkable.partnerCapabilitySample,
    isList: true,
    filterable: ["id", "title", "technique", "technique_slug", "material", "product_type"],
  }
)

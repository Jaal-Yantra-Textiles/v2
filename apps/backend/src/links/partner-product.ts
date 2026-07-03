import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import ProductModule from "@medusajs/medusa/product"

// #859 S2 (#861): partner ↔ product ownership link for the artisan quasi-partner
// flow. A `core_channel_listing` partner proposes a product (status=proposed);
// this link lets the cross-list subscriber resolve product → owning partner
// cleanly on publish (instead of the fragile product → sales_channel → store →
// partner multi-hop). One partner owns many products; a product has one owner.
export default defineLink(
  {
    linkable: PartnerModule.linkable.partner,
    isList: true,
    field: "products",
  },
  {
    linkable: ProductModule.linkable.product,
    isList: true,
  }
)

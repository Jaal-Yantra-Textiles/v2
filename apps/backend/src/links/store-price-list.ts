import { defineLink } from "@medusajs/framework/utils"
import StoreModule from "@medusajs/medusa/store"
import PricingModule from "@medusajs/medusa/pricing"

/**
 * Price lists are GLOBAL in core — nothing about a price list says whose it is.
 * This link is what makes `validatePartnerEntityOwnership(…, "price_lists", …)`
 * able to answer that question, exactly as it already does for customer groups,
 * customers, product categories and collections.
 *
 * It is a hard prerequisite for quote-minted pricing (#1389 S3): a quote writes
 * a price list scoped to a buyer's customer group, and a partner must not be
 * able to read, edit or delete another partner's negotiated prices.
 */
export default defineLink(
  StoreModule.linkable.store,
  { linkable: PricingModule.linkable.priceList, isList: true, field: "price_lists" }
)

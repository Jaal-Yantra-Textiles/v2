import { defineLink } from "@medusajs/framework/utils"
import PartnerModule from "../modules/partner"
import StockLocationModule from "@medusajs/medusa/stock-location"

/**
 * Link a Partner to the stock location(s) where its finished goods are banked.
 *
 * 🔴 Why this exists (#2053).
 *
 * `resolvePartnerLocationStep` used to find a partner's warehouse by walking
 * `partner → stores[0] → default_sales_channel_id → sales_channels →
 * stock_locations[0]`. Every hop can come back undefined, and all of them did so
 * SILENTLY. Measured on prod 2026-09-14: **17 of 30 partners have no store at
 * all**, so that chain resolved to nothing and their finished goods were never
 * banked — the run completed and the stock simply did not appear.
 *
 * Seven of those seventeen already HAVE a real warehouse row (Kiyo Designs,
 * Basak Handloom, Azmat Handloom, Bhagalpur Silks, bismajan, Le Atelier, Haresh
 * Hemraj Manodhiya) — one of them with a live Shiprocket pickup registration.
 * The warehouse was never missing; it was unreachable. Minting a second one per
 * partner would have split their stock across two locations, which is a correct
 * total with a wrong split.
 *
 * So the relationship is stated directly instead of being inferred. A partner
 * needs somewhere to put goods; it does NOT need a storefront, a sales channel
 * or a currency to have one.
 *
 * EXPORTED deliberately — see the note in `partner-stores-link.ts`. A link whose
 * `entryPoint` nothing can reach cannot be read safely: an empty `query.graph`
 * hop is indistinguishable from "this partner has no warehouse", and believing
 * that is exactly the failure being fixed.
 *
 * `isList: true` on the location side: a partner may operate more than one
 * warehouse. The resolver refuses to guess when it finds several — see
 * `pickPartnerLocation`.
 */
export default defineLink(
  PartnerModule.linkable.partner,
  {
    linkable: StockLocationModule.linkable.stockLocation,
    isList: true,
    field: "stock_locations",
  }
)

import PricingModule from "@medusajs/medusa/pricing"
import { defineLink } from "@medusajs/framework/utils"
import FxRatesModule from "../modules/fx_rates"

// 1:1 link from a Medusa Price to our FxPriceMeta marker. A price has
// either zero or one fx_price_meta row — its presence means "fanout
// (or daily re-rate) created this price"; absence means partner set
// it manually.
//
// The link is exposed on the price as `fx_price_meta` so partner-side
// queries can pull the marker + per-price audit fields in a single
// `query.graph` call:
//
//   fields: ["id", "amount", "currency_code", "fx_price_meta.*"]
//
// See src/modules/fx_rates/models/fx-price-meta.ts for the rationale
// behind a separate table (Medusa's Price has no metadata column).
export default defineLink(
  PricingModule.linkable.price,
  { linkable: FxRatesModule.linkable.fxPriceMeta, field: "fx_price_meta" }
)

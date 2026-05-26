import { model } from "@medusajs/framework/utils"

/**
 * Per-price marker that says "this Medusa Price row was created by
 * the FX fanout subscriber (or by re-rate) and is safe to overwrite
 * next time rates move."
 *
 * Why a separate table
 *   Medusa's Price model has no `metadata` column (verified against
 *   node_modules/@medusajs/pricing/dist/models/price.d.ts + the live
 *   DB schema), so we can't stash this on the price row itself. Sticks
 *   into Medusa's link system instead — see src/links/price-fx-meta.ts.
 *
 * Why "row presence = is auto-converted" (no boolean column)
 *   The discriminator we actually need is "did fanout create this
 *   row?". A row exists iff yes. When the partner edits an auto cell
 *   to set a manual price, the fanout marker is no longer accurate
 *   and we just delete the row. Simpler than carrying a flag + a
 *   manually-overridden-at timestamp; if we later need the audit
 *   trail we can add a soft-delete column.
 *
 * `source_price_id` is the partner's hand-set base price the auto
 * row was derived from. Daily re-rate (PR G5) reads (base_amount,
 * fx_rate) to recompute amount = base_amount × fresh_rate. Kept as
 * loose text — not a hard FK — so deletion of the source price
 * doesn't cascade-block ours; the re-rate job tolerates an orphan
 * by leaving the price alone.
 */
const FxPriceMeta = model.define("fx_price_meta", {
  id: model.id().primaryKey(),
  base_currency: model.text(),
  base_amount: model.bigNumber(),
  fx_rate: model.bigNumber(),
  source_price_id: model.text().nullable(),
})

export default FxPriceMeta

import { model } from "@medusajs/framework/utils"

/**
 * Whether a stock location is OURS.
 *
 * "Core" was never a thing the system knew. It was inferred: the brand store
 * was whichever store no partner linked to, and its `default_location_id` was
 * the one place stock could be deducted from. That inference is both too narrow
 * and too fragile — it cannot express stocking at several of our own
 * warehouses, and it breaks outright when a store exists without a partner
 * link (prod carries `Sharhlo Store`, a mis-spelled orphan of the
 * partner-linked `Sharlho Store`, and the resolver now throws `found 2`).
 *
 * Ownership decides whether material moves at all, so it is recorded, not
 * derived. One row per stock location; a location with NO row is treated as
 * non-core, because defaulting an unknown location to "ours" would deduct
 * partner-held stock — the one outcome the whole boundary exists to prevent.
 */
const LocationOwnership = model.define("location_ownership", {
  id: model.id().primaryKey(),
  /** The stock location this describes. One row per location. */
  stock_location_id: model.text().unique(),
  /** True when we own the stock held here and may deduct consumption from it. */
  is_core: model.boolean().default(false),
  /** Why it was marked this way — free text for the operator who set it. */
  note: model.text().nullable(),
})

export default LocationOwnership

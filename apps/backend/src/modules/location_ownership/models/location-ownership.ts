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
  /**
   * Whether an export may LEAVE from here (#1498).
   *
   * 🔴 Split from `is_core` on purpose. `is_core` answers "may we deduct
   * consumption from this stock"; the freight relay was reading it as "may we
   * export from here", and the two are not the same question. Prod has exactly
   * two `is_core` locations and one of them is **Dharamshala**, which is not an
   * export hub — a shipment relayed there to be exported would be relayed to
   * the wrong place, and priced as though it worked.
   *
   * 🔑 NULLABLE, and null is not false. A row written before this column
   * existed has no opinion, and the resolver falls back to `is_core` for the
   * whole set in that case — so nothing changes until an operator states the
   * first explicit answer, and the day they do, the inference stops entirely.
   * A `false` here is a decision; a null is the absence of one.
   */
  is_export_origin: model.boolean().nullable(),
  /** Why it was marked this way — free text for the operator who set it. */
  note: model.text().nullable(),
})

export default LocationOwnership

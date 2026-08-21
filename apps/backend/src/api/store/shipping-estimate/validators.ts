import { z } from "zod"

/**
 * Query for the public freight estimate (#1389).
 *
 * Everything arrives as a string on a GET, so numerics are coerced. `quantity`
 * is capped: this is a bulk-order estimate, but an unbounded quantity is just a
 * way to mint unique cache keys and drive carrier calls from a public route.
 */
export const StoreShippingEstimateSchema = z.object({
  variant_id: z.string().min(1),
  quantity: z.coerce.number().int().positive().max(100000),
  destination_postal_code: z.string().min(3).max(16),
  /** ISO-2. Drives the domestic-vs-cross-border branch inside the adapter. */
  country_code: z.string().min(2).max(2).optional(),
  /**
   * Restricts manual/flat options to those priced in this currency. Optional
   * because this route predates it; when absent, options are not
   * currency-filtered, which is what every existing caller already gets.
   * Supplying it is strictly safer — the picker sorts on the raw amount, so a
   * foreign-currency option wins whenever its number is smaller.
   */
  currency_code: z.string().min(3).max(3).optional(),
  /** Defaults to the aggregator, which returns every courier on the lane. */
  carrier: z.string().min(2).max(40).optional(),
})

export type StoreShippingEstimateReq = z.infer<
  typeof StoreShippingEstimateSchema
>

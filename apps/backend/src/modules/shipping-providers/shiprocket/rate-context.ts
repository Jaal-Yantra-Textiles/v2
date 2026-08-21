import { isInternationalDestination } from "../destination"
import type { Dimensions } from "../provider-interface"

/**
 * Turn Medusa's `calculatePrice` context into a carrier rate query — PURE, so
 * the rule that decides a buyer's freight is testable without a container, a
 * cart or a live Shiprocket account (#1417).
 *
 * ## Why this exists
 *
 * `ShiprocketFulfillmentService.calculatePrice` derived all of this inline and
 * got two things wrong in a way nothing could see:
 *
 * 1. It required a **6-digit PIN on both ends**. A foreign postcode never
 *    matches, so every cross-border cart fell straight into the catch-all and
 *    was quoted **0** — free shipping, wearing the same shape as a real quote.
 * 2. It never passed `destination_country`, so even a lane that *did* pass the
 *    regex went to the domestic `/courier/serviceability` endpoint, which
 *    answers a foreign destination with an empty courier list and calls that
 *    success.
 *
 * The order-level rate workflow (`workflows/orders/shiprocket-rates.ts`) has
 * had this right for a while — it branches on the destination country and lets
 * a cross-border quote through without a pincode. This brings the cart path
 * onto the same rule instead of leaving two freight derivations to disagree.
 *
 * ## The asymmetry is deliberate
 *
 * Domestic serviceability genuinely needs the delivery pincode. A cross-border
 * quote is priced on destination COUNTRY + weight, so a missing/foreign postal
 * code must not block it — but the ORIGIN pincode is required in both modes
 * (Shiprocket's international endpoint 400s without `pickup_postcode`).
 */

export type ShiprocketRateContext = {
  origin_pincode: string
  destination_pincode: string
  destination_country?: string
  weight_grams: number
  dimensions_cm?: Dimensions
  international: boolean
}

/** Shiprocket's own pincode shape. Indian PINs are exactly six digits. */
const isIndianPincode = (value: string): boolean => /^\d{6}$/.test(value)

/**
 * The weight a consignment is quoted at.
 *
 * Unlike `buildShippingEstimate` — which REFUSES when no weight exists, because
 * a quote is a number a buyer decides on — a cart must still be checkout-able,
 * so this estimates. That difference is intentional and is the same split the
 * order-83 fulfilment path already makes.
 *
 * 🔑 140 of 183 variants platform-wide carry no weight at either level, so the
 * estimate branch is the COMMON path here, not the edge case.
 */
export function resolveConsignmentWeightGrams(items: any[]): number {
  let totalWeight = 0
  let totalQty = 0
  let hasWeight = false

  for (const item of items || []) {
    const qty = Number(item?.quantity) || 1
    totalQty += qty
    // A variant with no weight of its own inherits the PRODUCT's — the same
    // fallback `resolveUnitWeight` makes for the quote builder. Without it a
    // basket of product-weighted variants quotes as if it were weightless.
    const unit =
      Number(item?.variant?.weight) || Number(item?.variant?.product?.weight) || 0
    if (unit > 0) {
      hasWeight = true
      totalWeight += unit * qty
    }
  }

  if (!hasWeight) return Math.max(400, totalQty * 400)
  return totalWeight
}

/**
 * The consignment's box.
 *
 * Dimensions are NOT cosmetic on a cross-border quote — international couriers
 * price on VOLUMETRIC weight and the size also decides who will carry it at all
 * (live-verified: 60×50×40 dropped a lane from 5 couriers to 2 and ₹3119 to
 * ₹8477). Quoting without them understates the price and offers couriers that
 * cannot take the parcel.
 *
 * 🔑 The stacking rule — widest footprint, summed height — is NOT a fresh
 * invention: it is exactly what `createFulfillment` in this same service already
 * does when it hands a parcel to the carrier. Deriving the quote box differently
 * from the shipment box would price a parcel we never send, which is the same
 * class of defect as having two freight paths that disagree.
 *
 * All-or-nothing per item, mirroring `parseRateQuery`: a partial box (length but
 * no height) cannot be turned into a volume, and inventing the missing side
 * would silently change the price. When NO item carries a full box we return
 * undefined and let the carrier price on weight alone — a fabricated box is
 * worse than no box, because the carrier would price it as fact.
 */
export function resolveConsignmentDimensions(
  items: any[]
): Dimensions | undefined {
  let maxLength = 0
  let maxWidth = 0
  let totalHeight = 0

  for (const item of items || []) {
    const v = item?.variant
    const length = Number(v?.length)
    const width = Number(v?.width)
    const height = Number(v?.height)
    if (!(length > 0) || !(width > 0) || !(height > 0)) continue

    const qty = Number(item?.quantity) || 1
    if (length > maxLength) maxLength = length
    if (width > maxWidth) maxWidth = width
    totalHeight += height * qty
  }

  if (!(maxLength > 0) || !(maxWidth > 0) || !(totalHeight > 0)) return undefined
  return { length: maxLength, width: maxWidth, height: totalHeight }
}

/**
 * Derive the rate query, or explain why the lane cannot be quoted.
 *
 * Returns `{ context }` when quotable and `{ reason }` when not. It does NOT
 * throw: the caller decides what an unquotable lane costs, and that decision
 * (flat fallback vs. refusal) is policy, not derivation.
 */
export function deriveShiprocketRateContext(context: any): {
  context?: ShiprocketRateContext
  reason?: string
} {
  const originPincode = String(
    context?.from_location?.address?.postal_code || ""
  ).trim()
  const destinationPincode = String(
    context?.shipping_address?.postal_code || ""
  ).trim()
  const destinationCountry = String(
    context?.shipping_address?.country_code || ""
  )
    .trim()
    .toUpperCase()

  const international = isInternationalDestination(destinationCountry)

  // Required in BOTH modes — the international endpoint 400s without a
  // `pickup_postcode`, so sending one we know is missing just buys a slower no.
  if (!isIndianPincode(originPincode)) {
    return {
      reason:
        "the pickup location has no valid 6-digit pincode, so Shiprocket cannot be asked for a rate",
    }
  }

  // Domestic serviceability is keyed on the delivery pincode; cross-border is
  // keyed on the country, and a foreign postal code is not six digits by
  // design. Only enforce the shape where it is actually the lookup key.
  //
  // An ABSENT country counts as domestic (`isInternationalDestination("")` is
  // false), so it lands here and is held to the Indian pincode shape — which is
  // the right refusal: we would otherwise quote a cross-border lane as if it
  // were local.
  if (!international && !isIndianPincode(destinationPincode)) {
    return {
      reason: `the destination pincode "${destinationPincode}" is not a valid 6-digit Indian pincode`,
    }
  }

  const items = (context?.items || []) as any[]

  return {
    context: {
      origin_pincode: originPincode,
      destination_pincode: destinationPincode,
      // Domestic stays undefined so the client keeps its existing branch: it
      // reaches for the cross-border product on the presence of a foreign
      // country, not on the string "IN".
      destination_country: international ? destinationCountry : undefined,
      weight_grams: resolveConsignmentWeightGrams(items),
      dimensions_cm: resolveConsignmentDimensions(items),
      international,
    },
  }
}

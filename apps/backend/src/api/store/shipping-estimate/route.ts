import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"

import { getStoreFromPublishableKey } from "../helpers"
import { resolveShippingProvider } from "../../../modules/shipping-providers/resolver"

/**
 * GET /store/shipping-estimate
 *
 * Public, storefront-facing freight estimate for a quantity of one variant —
 * the number a business buyer needs before committing to a bulk order (#1389).
 *
 * SCOPING, AND WHAT IT IS NOT
 * ---------------------------
 * The store is resolved from the publishable key's sales channel, the same way
 * every other store route scopes itself. ⚠️ That is IDENTIFICATION, not
 * protection: the key ships inside the storefront's JS bundle
 * (`NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`) and is visible in any browser's
 * network tab. Anyone can lift it. So this route is designed to be cheap to
 * hammer rather than hard to reach:
 *
 *   - manual/flat options are read from the DB and cost NO carrier call at all,
 *     which is the common case;
 *   - calculated rates are cached per (carrier, origin, destination, weight
 *     bucket), so repeated quotes for the same lane hit the cache, not the
 *     provider.
 *
 * There is no HTTP rate limiter here because the store API has none anywhere
 * yet; adding one is a separate piece of infrastructure, tracked on #1389.
 *
 * 🔑 WEIGHT IS REFUSED, NEVER GUESSED
 * The order-83 path estimates a weight when no variant carries one, and that is
 * fine for an internal fulfilment retry. It is NOT fine here: a guessed weight
 * becomes a freight number a buyer decides on. A variant without a weight gets
 * a 422 naming the variant, so the gap is fixed in the catalogue rather than
 * papered over in the quote.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const {
    variant_id: variantId,
    quantity: rawQuantity,
    destination_postal_code: destinationPostalCode,
    country_code: rawCountryCode,
    carrier: rawCarrier,
  } = req.validatedQuery as Record<string, any>

  const quantity = Number(rawQuantity)
  const countryCode = String(rawCountryCode || "in").toLowerCase()

  const store = await getStoreFromPublishableKey(
    (req as any).publishable_key_context || { sales_channel_ids: [] },
    req.scope
  )
  if (!store) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No store is linked to this publishable key's sales channel"
    )
  }

  // ---- Weight ------------------------------------------------------------
  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "title", "weight", "product.id", "product.title"],
    filters: { id: variantId },
  })
  const variant = variants?.[0] as any
  if (!variant) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Variant ${variantId} not found`
    )
  }

  const unitWeight = Number(variant.weight)
  if (!unitWeight || Number.isNaN(unitWeight) || unitWeight <= 0) {
    // Deliberately a refusal, not a fallback. See the header.
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Variant "${variant.title || variant.id}" has no shipping weight, so freight cannot be quoted for it. Set a weight on the variant first.`
    )
  }
  const weightGrams = Math.round(unitWeight * quantity)

  // ---- Origin ------------------------------------------------------------
  const { data: locations } = await query.graph({
    entity: "stock_locations",
    fields: ["id", "name", "address.postal_code", "address.country_code"],
    filters: { id: store.default_location_id },
  })
  const originPostalCode = String(
    (locations?.[0] as any)?.address?.postal_code || ""
  ).trim()
  if (!originPostalCode) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This store's pickup location has no postal code, so freight cannot be quoted. Add one to the location."
    )
  }

  // ---- Manual / flat options — no carrier call ---------------------------
  const { data: optionLocations } = await query.graph({
    entity: "stock_locations",
    fields: [
      "id",
      "fulfillment_sets.service_zones.shipping_options.id",
      "fulfillment_sets.service_zones.shipping_options.name",
      "fulfillment_sets.service_zones.shipping_options.price_type",
      "fulfillment_sets.service_zones.shipping_options.prices.*",
    ],
    filters: { id: store.default_location_id },
  })

  const manual: any[] = []
  for (const fs of (optionLocations?.[0] as any)?.fulfillment_sets || []) {
    for (const zone of fs?.service_zones || []) {
      for (const so of zone?.shipping_options || []) {
        if (so?.price_type === "calculated") continue
        for (const price of so?.prices || []) {
          // Only currency-scoped flat prices are meaningful without a cart;
          // region-scoped ones need a region the estimate does not have.
          if (!price?.currency_code) continue
          manual.push({
            shipping_option_id: so.id,
            name: so.name,
            amount: Number(price.amount),
            currency_code: String(price.currency_code).toLowerCase(),
            source: "manual",
          })
        }
      }
    }
  }

  // ---- Calculated rates — cached per lane --------------------------------
  const carrier = String(rawCarrier || "shiprocket").toLowerCase()
  // Bucket the weight so near-identical quantities share a cache entry rather
  // than minting one per quantity a buyer drags a slider through.
  const weightBucket = Math.ceil(weightGrams / 500) * 500
  const cacheKey = `shipping-estimate:${carrier}:${originPostalCode}:${destinationPostalCode}:${countryCode}:${weightBucket}`

  let calculated: any[] = []
  let calculatedError: string | null = null
  let cacheHit = false

  const cacheService: any = req.scope.resolve(Modules.CACHE)
  const cached = await cacheService.get(cacheKey).catch(() => null)
  if (cached) {
    calculated = cached as any[]
    cacheHit = true
  } else {
    try {
      const provider = await resolveShippingProvider(req.scope, carrier)
      if (!provider.getRates) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          `${carrier} does not support rate quotes`
        )
      }
      const rates = await provider.getRates({
        origin_pincode: originPostalCode,
        destination_pincode: String(destinationPostalCode),
        destination_country: countryCode,
        weight_grams: weightBucket,
      })
      calculated = (rates || []).map((r: any) => ({
        courier_id: r.courier_id ?? null,
        courier_name: r.courier_name ?? null,
        amount: Number(r.amount),
        currency_code: String(r.currency_code || "inr").toLowerCase(),
        estimated_days: r.estimated_days ?? null,
        is_recommended: !!r.is_recommended,
        source: "calculated",
      }))
      await cacheService.set(cacheKey, calculated, 900).catch(() => {})
    } catch (err) {
      // A carrier that will not quote must not blank the whole estimate — the
      // manual options are still a real, quotable answer.
      calculatedError = err instanceof Error ? err.message : String(err)
      logger?.warn?.(
        `[store/shipping-estimate] ${carrier} rates failed for ${originPostalCode}->${destinationPostalCode}: ${calculatedError}`
      )
    }
  }

  res.json({
    estimate: {
      variant_id: variant.id,
      product_title: variant.product?.title ?? null,
      quantity,
      unit_weight_grams: unitWeight,
      total_weight_grams: weightGrams,
      origin_postal_code: originPostalCode,
      destination_postal_code: String(destinationPostalCode),
      country_code: countryCode,
      manual,
      calculated,
      calculated_error: calculatedError,
      cache_hit: cacheHit,
      // Never present these as a final price: carrier rates move, and the
      // manual tier is a placeholder the partner is expected to edit.
      is_estimate: true,
    },
  })
}

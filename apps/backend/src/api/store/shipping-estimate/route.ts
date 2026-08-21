import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { getStoreFromPublishableKey } from "../helpers"
import { buildShippingEstimate } from "../../../lib/shipping-estimate"

/**
 * GET /store/shipping-estimate
 *
 * Public, storefront-facing freight estimate for a quantity of one variant —
 * the number a business buyer needs before committing to a bulk order (#1389).
 *
 * The estimate itself lives in `lib/shipping-estimate.ts` because the B2B quote
 * builder needs the same number, and the only ways to share a route body are to
 * copy it (two freight paths that will disagree) or to HTTP to yourself. This
 * route is now scoping plus a function call — the weight rule, the cache and
 * the response shape are all one implementation.
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
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const {
    variant_id: variantId,
    quantity: rawQuantity,
    destination_postal_code: destinationPostalCode,
    country_code: rawCountryCode,
    currency_code: rawCurrencyCode,
    carrier: rawCarrier,
  } = req.validatedQuery as Record<string, any>

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

  const estimate = await buildShippingEstimate(req.scope, {
    lines: [{ variant_id: variantId, quantity: Number(rawQuantity) }],
    destination_postal_code: String(destinationPostalCode),
    country_code: rawCountryCode,
    // Optional here (this route predates it) — when absent the manual options
    // are not currency-filtered, which is the behaviour every existing caller
    // already has. Supplying it is strictly safer.
    currency_code: rawCurrencyCode,
    carrier: rawCarrier,
    store,
  })

  // This route's public contract is single-variant and the storefront reads
  // these exact keys, so the one-line basket is flattened back to the shape it
  // has always returned. `lines` is included too, so a caller that wants the
  // per-line breakdown does not have to call something else for it.
  const line = estimate.lines[0]

  res.json({
    estimate: {
      ...estimate,
      variant_id: line.variant_id,
      product_title: line.product_title,
      quantity: line.quantity,
      unit_weight_grams: line.unit_weight_grams,
      weight_source: line.weight_source,
    },
  })
}

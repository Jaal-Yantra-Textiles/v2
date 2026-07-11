import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  dedupeStripeProviders,
  resolvePartnerConnectedByRegion,
} from "../../../modules/stripe-connect-payment/lib/resolve-connect"

/**
 * Override of the core store payment-providers route
 * (GET /store/payment-providers?region_id=...).
 *
 * Behaviourally identical to core — returns the enabled payment providers linked
 * to the region — EXCEPT that the two Stripe providers are collapsed into a
 * single buyer-facing "Stripe", chosen by the region's OWNING partner's Stripe
 * Connect status (#985):
 *
 *   • partner onboarded on Connect (charges enabled) → `pp_stripe-connect_stripe-connect`
 *     (the shopper's payment routes into the merchant's connected account)
 *   • otherwise (not onboarded, or the core store)    → `pp_stripe_stripe`
 *     (standard platform Stripe)
 *
 * This fixes the reported bug where an India partner's storefront serving an EU
 * region showed "Stripe Connect" — India partners are never Connect-onboarded
 * (Connect is EUR-gated, #838), so they now correctly see standard Stripe. The
 * choice keys on the partner, not the region currency, so a partner's own
 * onboarding status is what decides which single Stripe surface the buyer gets.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const regionId = (req.query?.region_id as string) || undefined
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Providers linked to the region (mirrors core's region-scoped listing).
  let providers: Array<{ id: string; is_enabled?: boolean }> = []
  if (regionId) {
    const { data } = await query
      .graph({
        entity: "region",
        filters: { id: regionId },
        fields: ["payment_providers.id", "payment_providers.is_enabled"],
      })
      .catch(() => ({ data: [] as any[] }))
    providers = ((data?.[0]?.payment_providers ?? []) as any[])
      .filter((p) => p?.id && p?.is_enabled !== false)
      .map((p) => ({ id: p.id as string, is_enabled: p.is_enabled }))
  }

  const connected = await resolvePartnerConnectedByRegion(req.scope, regionId).catch(
    () => false
  )
  const payment_providers = dedupeStripeProviders(providers, connected)

  res.json({
    payment_providers,
    count: payment_providers.length,
    offset: 0,
    limit: payment_providers.length,
  })
}

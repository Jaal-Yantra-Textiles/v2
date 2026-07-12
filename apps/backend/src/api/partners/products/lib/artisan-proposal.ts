import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../../../modules/partner"
import { PARTNER_ONBOARDING_PROFILE_MODULE } from "../../../../modules/partner-onboarding-profile"

/**
 * Artisan quasi-partner proposal helpers (#859 S2 / #861).
 *
 * A `core_channel_listing` partner (the "Airbnb-style" seller who lists on the
 * core cicilabel.com channel instead of running their own storefront) does NOT
 * publish directly: their products enter as `proposed` (native ProductStatus),
 * an admin verifies/approves, and only then are they published + cross-listed.
 *
 * This lives in a shared lib because BOTH product-create routes must apply the
 * gate identically — the legacy `POST /partners/products` and the store-scoped
 * `POST /partners/stores/:id/products` that the partner-ui actually calls.
 */

/**
 * Is this partner an artisan who lists on the core channel (and therefore whose
 * products must enter the proposal queue)? Never throws — a missing profile or
 * lookup error is treated as "not core-channel" so the normal publish path is
 * preserved.
 */
export const isCoreChannelListingPartner = async (
  scope: any,
  partnerId: string
): Promise<boolean> => {
  const onboardingService: any = scope.resolve(
    PARTNER_ONBOARDING_PROFILE_MODULE
  )
  const profile = await onboardingService
    .findByPartner(partnerId)
    .catch(() => null)
  return profile?.selling_mode === "core_channel_listing"
}

/**
 * Record product → owning-partner ownership link and emit the dedicated
 * `partner_product.proposed` event (the seam for admin-review notifications and
 * visual flows — registered in visual-flow-event-trigger.ts). Kept off the
 * generic product firehose so flows only wake on real artisan proposals.
 * Never throws.
 */
export const recordArtisanProposal = async (
  scope: any,
  partnerId: string,
  productId: string
): Promise<void> => {
  const remoteLink = scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink
    .create({
      [PARTNER_MODULE]: { partner_id: partnerId },
      [Modules.PRODUCT]: { product_id: productId },
    })
    .catch(() => {})

  const eventBus = scope.resolve(Modules.EVENT_BUS) as any
  await eventBus
    .emit({
      name: "partner_product.proposed",
      data: { id: productId, partner_id: partnerId },
    })
    .catch(() => {})
}

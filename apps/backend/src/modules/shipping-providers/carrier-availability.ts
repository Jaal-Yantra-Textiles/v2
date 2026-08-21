import {
  CARRIER_CAPABILITIES,
  CarrierCapability,
  fulfillmentProviderId,
  groupCarriersByLane,
} from "./carrier-capabilities"

/**
 * "Which carriers can this location actually use, and for which lane?" (#1417)
 *
 * Three facts have to meet before a carrier is genuinely available, and each is
 * held somewhere different:
 *
 * 1. **Capability** — can the adapter rate/ship this lane at all
 *    (`carrier-capabilities.ts`).
 * 2. **Registration** — is the provider registered in this deployment. Gated on
 *    credentials in `medusa-config`, so a carrier with no keys never appears.
 * 3. **Linkage** — is it linked to THIS stock location
 *    (`stock_location ↔ fulfillment_provider`), which is where a partner's own
 *    selection already lives.
 *
 * 🔑 There is deliberately no new table here. The partner→carrier mapping is
 * already the location link — a second store of the same fact would drift from
 * it, and the link is what core consults at fulfilment time regardless of what
 * any side table said.
 *
 * The shape is built PURE so the composition is testable without a container:
 * the routes fetch the two id lists and hand them in.
 */

export type CarrierAvailability = CarrierCapability & {
  /** Registered as a fulfillment provider in this deployment. */
  registered: boolean
  /** Linked to the location in question — i.e. this partner selected it. */
  enabled: boolean
  /** The Medusa fulfillment-provider id, for add/remove calls. */
  provider_id: string
  /**
   * Why it cannot be turned on right now, if it cannot. Null when selectable.
   * Surfaced so a greyed-out row in the picker can say WHY rather than just
   * being unclickable.
   */
  blocked_reason: string | null
}

export function buildCarrierAvailability(args: {
  /** Fulfillment provider ids registered in this deployment. */
  registeredProviderIds: string[]
  /** Fulfillment provider ids linked to this location. */
  linkedProviderIds: string[]
  carriers?: CarrierCapability[]
}): {
  carriers: CarrierAvailability[]
  domestic: { rating: string[]; shipping: string[] }
  international: { rating: string[]; shipping: string[] }
} {
  const registered = new Set(args.registeredProviderIds || [])
  const linked = new Set(args.linkedProviderIds || [])
  const source = args.carriers ?? CARRIER_CAPABILITIES

  const carriers: CarrierAvailability[] = source.map((capability) => {
    const providerId = fulfillmentProviderId(capability.id)
    const isRegistered = registered.has(providerId)

    let blocked: string | null = null
    if (!capability.integrated) {
      blocked = `${capability.label} is not integrated yet.`
    } else if (!isRegistered) {
      // The commonest real case: the adapter exists but this deployment has no
      // credentials for it, so the provider was never registered.
      blocked = `${capability.label} is not configured on this deployment — its credentials are missing.`
    }

    return {
      ...capability,
      provider_id: providerId,
      registered: isRegistered,
      enabled: linked.has(providerId),
      blocked_reason: blocked,
    }
  })

  // The lane lists name only carriers that could actually be switched on here,
  // so a picker built from them cannot offer an unusable row.
  const selectable = carriers.filter((c) => !c.blocked_reason)
  const grouped = groupCarriersByLane(selectable)

  return {
    carriers,
    domestic: {
      rating: grouped.domestic.rating.map((c) => c.id),
      shipping: grouped.domestic.shipping.map((c) => c.id),
    },
    international: {
      rating: grouped.international.rating.map((c) => c.id),
      shipping: grouped.international.shipping.map((c) => c.id),
    },
  }
}

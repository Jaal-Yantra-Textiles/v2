import {
  CARRIER_CAPABILITIES,
  CarrierCapability,
  findCarrierCapability,
} from "./carrier-capabilities"

/**
 * Which carrier should be ASKED for a rate on this lane (#1447).
 *
 * ## The defect this exists to remove
 *
 * `buildShippingEstimate` defaulted to `"shiprocket"` whenever no carrier was
 * named, which is every partner quote ever minted. So a partner who has
 * enabled Delhivery — and only Delhivery — had their quotes priced by a carrier
 * they do not ship with. The number was plausible, which is why nobody noticed:
 * it is a real rate, for a real lane, from the wrong company. Their invoice and
 * their quote were never going to agree.
 *
 * The partner's enabled carriers are the `stock_location ↔ fulfillment_provider`
 * links — the same fact core consults at fulfilment time, and the same one the
 * carrier settings screen writes. There is deliberately no second table.
 *
 * ## Why this can still fall back
 *
 * A partner may have enabled only carriers that cannot RATE the lane in
 * question — Blue Dart ships internationally and quotes nothing, Delhivery
 * refuses cross-border outright. Returning null there hands the decision back
 * to the caller, which uses the platform default rather than leaving the buyer
 * with no freight at all: a quote with no number is worse than a quote whose
 * number came from the platform's account, and the alternative silently
 * un-prices lanes that work today.
 */

export type ShippingLane = "domestic" | "international"

/** The carrier id behind a Medusa fulfillment-provider id (`delhivery_delhivery`). */
export function carrierIdFromProviderId(providerId?: string | null): string | null {
  const id = String(providerId || "").trim().toLowerCase()
  if (!id) return null
  // Providers register as `${carrier}_${carrier}`; anything else is not ours.
  const [head] = id.split("_")
  return findCarrierCapability(head) ? head : null
}

/**
 * PURE. Pick the carrier to rate with, or null to leave it to the caller.
 *
 * Order follows `CARRIER_CAPABILITIES`, not the order the links came back in:
 * a link list is unordered, and "which carrier quoted this" flipping between
 * two mints of the same basket is a difference nobody can explain to a buyer.
 */
export function pickRatingCarrier(args: {
  /** Explicit choice — the admin picker, or a caller that knows better. */
  explicit?: string | null
  /** Carrier ids the partner has enabled on their location. */
  enabledCarrierIds: string[]
  lane: ShippingLane
  carriers?: CarrierCapability[]
}): string | null {
  const explicit = String(args.explicit || "").trim().toLowerCase()
  // "manual" is a real choice — ask nobody — and must survive this untouched.
  if (explicit) return explicit

  const enabled = new Set(
    (args.enabledCarrierIds || []).map((c) => String(c || "").toLowerCase())
  )
  if (!enabled.size) return null

  const source = args.carriers ?? CARRIER_CAPABILITIES
  const usable = source.find(
    (c) =>
      enabled.has(c.id) &&
      c.integrated &&
      (args.lane === "domestic" ? c.domestic.can_rate : c.international.can_rate)
  )

  return usable?.id ?? null
}

/**
 * Read the carriers a location has enabled. Never throws: a lookup failure
 * means "we do not know", which the caller treats as "no preference" — the same
 * as a partner who has enabled nothing. Failing the whole quote because a link
 * query hiccuped would be a far worse trade.
 */
export async function readEnabledCarrierIds(
  scope: any,
  locationId?: string | null
): Promise<string[]> {
  if (!locationId) return []
  try {
    const { ContainerRegistrationKeys } = await import(
      "@medusajs/framework/utils"
    )
    const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "stock_locations",
      fields: ["id", "fulfillment_providers.id"],
      filters: { id: locationId },
    })
    const providers = (data?.[0]?.fulfillment_providers ?? []) as any[]
    return providers
      .map((p) => carrierIdFromProviderId(p?.id))
      .filter((id): id is string => Boolean(id))
  } catch {
    return []
  }
}

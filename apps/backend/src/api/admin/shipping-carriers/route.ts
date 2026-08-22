import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { buildCarrierAvailability } from "../../../modules/shipping-providers/carrier-availability"

/**
 * The carrier picker's data, for an admin (#1417).
 *
 * Same answer as the partner route, reached differently: an admin has no
 * partner of their own, so `partner_id` is REQUIRED here and is the whole
 * difference between the two surfaces. Without it there is no location, and
 * without a location "which carriers are on" has no meaning — so this refuses
 * rather than returning a capability list that looks like an answer.
 *
 * 🔑 The admin route reads the SAME builder as the partner one. Two hand-rolled
 * versions of "is this carrier available" would disagree the first time a
 * carrier changed, and the admin's view is the one used to debug the partner's.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const partnerId = String((req.query.partner_id as string) || "").trim()
  if (!partnerId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "partner_id is required — carrier availability is per-partner, because it is read from that partner's stock location."
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "name", "stores.id", "stores.default_location_id"],
    filters: { id: partnerId },
  })
  const partner = partners?.[0] as any
  if (!partner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Partner not found")
  }

  const store = partner.stores?.[0]
  const locationId = store?.default_location_id

  const [{ data: providers }, linked] = await Promise.all([
    query.graph({ entity: "fulfillment_provider", fields: ["id", "is_enabled"] }),
    locationId
      ? query
          .graph({
            entity: "stock_locations",
            // `address.country_code` rides along because the caller that needs
            // the carriers is usually the same one that needs to know whether
            // this lane even CROSSES a border (#1447): DDP is meaningless on a
            // domestic quote, and the origin is not derivable from the
            // destination or the currency.
            fields: [
              "id",
              "fulfillment_providers.id",
              "address.country_code",
            ],
            filters: { id: locationId },
          })
          .then(({ data }: any) => ({
            providerIds: ((data?.[0]?.fulfillment_providers ?? []) as any[]).map(
              (p) => p.id
            ),
            countryCode:
              String(data?.[0]?.address?.country_code || "")
                .trim()
                .toUpperCase() || null,
          }))
      : Promise.resolve({ providerIds: [], countryCode: null }),
  ])

  const availability = buildCarrierAvailability({
    registeredProviderIds: (providers ?? [])
      .filter((p: any) => p.is_enabled !== false)
      .map((p: any) => p.id),
    linkedProviderIds: linked.providerIds,
  })

  res.json({
    ...availability,
    partner: { id: partner.id, name: partner.name ?? null },
    location_id: locationId ?? null,
    /**
     * Where the goods dispatch FROM. Null when there is no location or its
     * address carries no country — and null must read as "unknown", never as
     * "domestic": assuming would hide the DDP question on a real export.
     */
    origin_country_code: linked.countryCode,
    store_id: store?.id ?? null,
  })
}

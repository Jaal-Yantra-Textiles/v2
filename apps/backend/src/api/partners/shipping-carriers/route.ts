import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { getPartnerFromAuthContext } from "../helpers"
import { buildCarrierAvailability } from "../../../modules/shipping-providers/carrier-availability"

/**
 * The carrier picker's data, for a partner (#1417).
 *
 * Answers "which carriers can I ship on, domestic vs international, and which
 * have I already switched on" in one call — the three facts that decide it live
 * in three different places (adapter capability, deployment registration,
 * location link) and a UI should not have to join them itself.
 *
 * 🔑 The partner comes from the AUTH CONTEXT; the location comes from the
 * partner's own store. Nothing here is taken from the query string, so one
 * partner cannot read another's carrier setup by guessing a location id.
 *
 * Turning a carrier ON is not done here — that is the existing
 * `POST /partners/stores/:id/locations/:locationId/fulfillment-providers`,
 * which owns the link. This route is deliberately read-only so there is one
 * writer for that link, not two.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "stores.id", "stores.default_location_id"],
    filters: { id: partner.id },
  })
  const store = (partners?.[0] as any)?.stores?.[0]
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
    // Null when the partner has no store/location yet — the picker needs to say
    // "finish setting up your location first" rather than showing every carrier
    // as switchable against nothing.
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

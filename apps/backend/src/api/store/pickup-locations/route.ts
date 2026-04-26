import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/pickup-locations?postal_code=400001&country_code=in
 *
 * Returns stock locations that have pickup fulfillment sets enabled,
 * scoped to the requesting publishable key's sales channel.
 * Sorted by proximity (matching postal code prefix).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const postalCode = String(req.query.postal_code || "").trim()
  const countryCode = String(req.query.country_code || "").trim().toLowerCase()

  // Get sales channel IDs from publishable key
  const salesChannelIds =
    (req as any).publishable_key_context?.sales_channel_ids || []

  if (!salesChannelIds.length) {
    return res.json({ pickup_locations: [], count: 0 })
  }

  // Find stock locations linked to these sales channels
  const { data: scLinks } = await query.graph({
    entity: "sales_channel_location",
    fields: ["stock_location_id"],
    filters: { sales_channel_id: salesChannelIds },
    pagination: { skip: 0, take: 100 },
  })

  const locationIds = (scLinks || [])
    .map((l: any) => l.stock_location_id)
    .filter(Boolean)

  if (!locationIds.length) {
    return res.json({ pickup_locations: [], count: 0 })
  }

  // Fetch full location details with fulfillment sets
  const { data: locations } = await query.graph({
    entity: "stock_locations",
    fields: [
      "id",
      "name",
      "address.address_1",
      "address.address_2",
      "address.city",
      "address.province",
      "address.postal_code",
      "address.country_code",
      "address.phone",
      "metadata",
      "fulfillment_sets.id",
      "fulfillment_sets.name",
      "fulfillment_sets.type",
      "fulfillment_sets.service_zones.id",
      "fulfillment_sets.service_zones.name",
      "fulfillment_sets.service_zones.shipping_options.id",
      "fulfillment_sets.service_zones.shipping_options.name",
      "fulfillment_sets.service_zones.shipping_options.price_type",
      "fulfillment_sets.service_zones.shipping_options.prices.amount",
      "fulfillment_sets.service_zones.shipping_options.prices.currency_code",
    ],
    filters: { id: locationIds },
  })

  // Filter to locations that have a pickup fulfillment set
  const pickupLocations = (locations || [])
    .filter((loc: any) => {
      const sets = loc.fulfillment_sets || []
      return sets.some((s: any) => s.type === "pickup")
    })
    .filter((loc: any) => {
      // If country_code is provided, filter by it
      if (countryCode && loc.address?.country_code) {
        return loc.address.country_code.toLowerCase() === countryCode
      }
      return true
    })
    .map((loc: any) => {
      const pickupSet = (loc.fulfillment_sets || []).find(
        (s: any) => s.type === "pickup"
      )
      const pickupOptions = (pickupSet?.service_zones || []).flatMap(
        (sz: any) =>
          (sz.shipping_options || []).map((opt: any) => ({
            id: opt.id,
            name: opt.name,
            price_type: opt.price_type,
            price: opt.prices?.[0]
              ? {
                  amount: opt.prices[0].amount,
                  currency_code: opt.prices[0].currency_code,
                }
              : null,
          }))
      )

      // Calculate proximity score based on postal code prefix matching
      let proximity = 0
      if (postalCode && loc.address?.postal_code) {
        const locPin = String(loc.address.postal_code)
        for (let i = 0; i < Math.min(postalCode.length, locPin.length); i++) {
          if (postalCode[i] === locPin[i]) {
            proximity++
          } else {
            break
          }
        }
      }

      return {
        id: loc.id,
        name: loc.name,
        address: {
          address_1: loc.address?.address_1 || "",
          address_2: loc.address?.address_2 || null,
          city: loc.address?.city || "",
          province: loc.address?.province || "",
          postal_code: loc.address?.postal_code || "",
          country_code: loc.address?.country_code || "",
          phone: loc.address?.phone || null,
        },
        pickup_options: pickupOptions,
        metadata: loc.metadata || null,
        proximity,
      }
    })
    .sort((a: any, b: any) => b.proximity - a.proximity)

  res.json({
    pickup_locations: pickupLocations,
    count: pickupLocations.length,
  })
}

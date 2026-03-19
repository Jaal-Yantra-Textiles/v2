/**
 * Fix missing shipping fulfillment sets for partner stock locations.
 *
 * Usage:
 *   npx medusa exec ./src/scripts/fix-partner-fulfillment-sets.ts
 *
 * What it does:
 *   1. Finds stock locations that have a pickup fulfillment set but no shipping set
 *   2. Creates a shipping fulfillment set with a service zone for the location's country
 *   3. Links it to the stock location
 *   4. Creates default shipping options (Standard + Return)
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function fixPartnerFulfillmentSets({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
  const fulfillmentService = container.resolve(Modules.FULFILLMENT) as any

  console.log("[fix-fulfillment] Scanning stock locations...")

  // Get all stock locations with their fulfillment sets and addresses
  const { data: locations } = await query.graph({
    entity: "stock_locations",
    fields: ["id", "name", "address.*"],
  })

  let fixedCount = 0

  for (const location of locations as any[]) {
    const locationId = location.id
    const locationName = location.name || "Unknown"

    // Get linked fulfillment sets
    const { data: linkData } = await query.graph({
      entity: "stock_locations",
      fields: ["id", "fulfillment_sets.*"],
      filters: { id: locationId },
    })

    const fulfillmentSets = (linkData?.[0] as any)?.fulfillment_sets || []
    const hasShipping = fulfillmentSets.some((fs: any) => fs.type === "shipping")
    const hasPickup = fulfillmentSets.some((fs: any) => fs.type === "pickup")

    if (hasShipping) {
      continue // Already has shipping, skip
    }

    const countryCode = (
      location.address?.country_code || "us"
    ).toLowerCase()
    const countryLabel = countryCode.toUpperCase()
    const suffix = locationId.slice(-8)

    console.log(
      `[fix-fulfillment] ${locationName} (${locationId}) — missing shipping set, country=${countryLabel}`
    )

    try {
      // Create shipping fulfillment set
      const shippingSet = await fulfillmentService.createFulfillmentSets({
        name: `Shipping (${suffix})`,
        type: "shipping",
        service_zones: [
          {
            name: `${countryLabel} Shipping Zone (${suffix})`,
            geo_zones: [{ country_code: countryCode, type: "country" }],
          },
        ],
      })

      // Link to stock location
      await remoteLink.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
        [Modules.FULFILLMENT]: { fulfillment_set_id: shippingSet.id },
      })

      console.log(
        `[fix-fulfillment]   ✓ Created shipping set: ${shippingSet.id}`
      )

      // Create default shipping options
      const serviceZone = shippingSet.service_zones?.[0]
      if (serviceZone) {
        const profiles = await fulfillmentService.listShippingProfiles(
          {},
          { take: 1 }
        )
        const profileId = profiles?.[0]?.id

        if (profileId) {
          // Pick provider based on country
          const providerMap: Record<string, string> = {
            in: "delhivery_delhivery",
          }
          const providerId = providerMap[countryCode] || "manual_manual"

          await fulfillmentService.createShippingOptions({
            name: "Standard Shipping",
            price_type: "flat",
            service_zone_id: serviceZone.id,
            shipping_profile_id: profileId,
            provider_id: providerId,
            type: {
              label: "Standard",
              description: "Standard delivery",
              code: "standard",
            },
            data: {},
            rules: [],
          })

          await fulfillmentService.createShippingOptions({
            name: "Return Shipping",
            price_type: "flat",
            service_zone_id: serviceZone.id,
            shipping_profile_id: profileId,
            provider_id: providerId,
            type: {
              label: "Return",
              description: "Return pickup",
              code: "return",
            },
            data: { is_return: true },
            rules: [],
          })

          console.log(
            `[fix-fulfillment]   ✓ Created Standard + Return shipping options`
          )
        }
      }

      // Also create pickup set if missing
      if (!hasPickup) {
        const pickupSet = await fulfillmentService.createFulfillmentSets({
          name: `Pickup (${suffix})`,
          type: "pickup",
          service_zones: [
            {
              name: `${countryLabel} Pickup Zone (${suffix})`,
              geo_zones: [{ country_code: countryCode, type: "country" }],
            },
          ],
        })

        await remoteLink.create({
          [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
          [Modules.FULFILLMENT]: { fulfillment_set_id: pickupSet.id },
        })

        console.log(
          `[fix-fulfillment]   ✓ Created pickup set: ${pickupSet.id}`
        )
      }

      fixedCount++
    } catch (e: any) {
      console.error(
        `[fix-fulfillment]   ✗ Failed for ${locationName}: ${e.message}`
      )
    }
  }

  console.log(
    `[fix-fulfillment] Done. Fixed ${fixedCount} location(s).`
  )
}

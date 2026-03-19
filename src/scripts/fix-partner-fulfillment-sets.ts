/**
 * Fix missing shipping fulfillment sets for partner store locations.
 *
 * Usage:
 *   npx medusa exec ./src/scripts/fix-partner-fulfillment-sets.ts
 *
 * What it does:
 *   1. Finds partners that have stores with a default_location_id
 *   2. For each location, checks if shipping + pickup fulfillment sets exist
 *   3. If missing, creates them with service zones for the location's country
 *   4. Picks the best available fulfillment provider based on country + what's enabled
 *   5. Creates default shipping options (Standard + Return)
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../modules/partner"

export default async function fixPartnerFulfillmentSets({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
  const fulfillmentService = container.resolve(Modules.FULFILLMENT) as any

  // 1. Get all available & enabled fulfillment providers
  const { data: providers } = await query.graph({
    entity: "fulfillment_provider",
    fields: ["id", "is_enabled"],
  })
  const enabledProviders = (providers || [])
    .filter((p: any) => p.is_enabled !== false)
    .map((p: any) => p.id)

  console.log(`[fix-fulfillment] Enabled fulfillment providers: ${enabledProviders.join(", ")}`)

  // 2. Get a shipping profile (needed for shipping options)
  const shippingProfiles = await fulfillmentService.listShippingProfiles({}, { take: 1 })
  const profileId = shippingProfiles?.[0]?.id
  if (!profileId) {
    console.error("[fix-fulfillment] No shipping profile found. Cannot create shipping options.")
    return
  }
  console.log(`[fix-fulfillment] Using shipping profile: ${profileId}`)

  // 3. Get all partners with their stores
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "name", "stores.*"],
  })

  console.log(`[fix-fulfillment] Found ${(partners || []).length} partner(s)`)

  let fixedCount = 0

  for (const partner of (partners || []) as any[]) {
    const stores = partner.stores || []
    if (!stores.length) continue

    for (const store of stores) {
      const locationId = store.default_location_id
      if (!locationId) {
        console.log(`[fix-fulfillment] Partner "${partner.name}" store "${store.name}" — no default location, skipping`)
        continue
      }

      // Get the location with address and fulfillment sets
      const { data: locData } = await query.graph({
        entity: "stock_locations",
        fields: ["id", "name", "address.*", "fulfillment_sets.*"],
        filters: { id: locationId },
      })

      const location = locData?.[0] as any
      if (!location) {
        console.log(`[fix-fulfillment] Location ${locationId} not found for partner "${partner.name}", skipping`)
        continue
      }

      const fulfillmentSets = location.fulfillment_sets || []
      const hasShipping = fulfillmentSets.some((fs: any) => fs.type === "shipping")
      const hasPickup = fulfillmentSets.some((fs: any) => fs.type === "pickup")

      if (hasShipping && hasPickup) {
        // Check if the shipping set has shipping options
        const shippingSet = fulfillmentSets.find((fs: any) => fs.type === "shipping")
        const { data: zones } = await query.graph({
          entity: "service_zone",
          fields: ["id", "shipping_options.*"],
          filters: { fulfillment_set_id: shippingSet.id },
        })
        const hasOptions = (zones || []).some(
          (z: any) => z.shipping_options?.length > 0
        )

        if (hasOptions) {
          console.log(`[fix-fulfillment] Partner "${partner.name}" / "${location.name}" — OK (shipping + pickup + options)`)
          continue
        }

        console.log(`[fix-fulfillment] Partner "${partner.name}" / "${location.name}" — has shipping set but NO options, will create them`)
      } else {
        console.log(
          `[fix-fulfillment] Partner "${partner.name}" / "${location.name}" — missing: ${!hasShipping ? "shipping" : ""} ${!hasPickup ? "pickup" : ""}`
        )
      }

      const countryCode = (location.address?.country_code || "us").toLowerCase()
      const countryLabel = countryCode.toUpperCase()
      const suffix = locationId.slice(-8)

      // Determine best provider for this country from what's available
      const providerId = pickProvider(countryCode, enabledProviders)
      console.log(`[fix-fulfillment]   Provider for ${countryLabel}: ${providerId}`)

      try {
        let shippingSet: any = null

        // Create shipping fulfillment set if missing
        if (!hasShipping) {
          shippingSet = await fulfillmentService.createFulfillmentSets({
            name: `Shipping (${suffix})`,
            type: "shipping",
            service_zones: [
              {
                name: `${countryLabel} Shipping Zone (${suffix})`,
                geo_zones: [{ country_code: countryCode, type: "country" }],
              },
            ],
          })

          await remoteLink.create({
            [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
            [Modules.FULFILLMENT]: { fulfillment_set_id: shippingSet.id },
          })

          console.log(`[fix-fulfillment]   ✓ Created shipping set: ${shippingSet.id}`)
        } else {
          shippingSet = fulfillmentSets.find((fs: any) => fs.type === "shipping")
        }

        // Create shipping options if the shipping set has a service zone
        const serviceZoneId = shippingSet?.service_zones?.[0]?.id
        if (serviceZoneId) {
          // Check if options already exist
          const { data: existingZones } = await query.graph({
            entity: "service_zone",
            fields: ["id", "shipping_options.id"],
            filters: { id: serviceZoneId },
          })
          const existingOptions = (existingZones?.[0] as any)?.shipping_options || []

          if (existingOptions.length === 0) {
            await fulfillmentService.createShippingOptions({
              name: "Standard Shipping",
              price_type: "flat",
              service_zone_id: serviceZoneId,
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
              service_zone_id: serviceZoneId,
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

            console.log(`[fix-fulfillment]   ✓ Created Standard + Return shipping options (provider: ${providerId})`)
          } else {
            console.log(`[fix-fulfillment]   → Shipping options already exist (${existingOptions.length}), skipping`)
          }
        }

        // Create pickup set if missing
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

          console.log(`[fix-fulfillment]   ✓ Created pickup set: ${pickupSet.id}`)
        }

        fixedCount++
      } catch (e: any) {
        console.error(`[fix-fulfillment]   ✗ Failed for "${location.name}": ${e.message}`)
      }
    }
  }

  console.log(`\n[fix-fulfillment] Done. Fixed ${fixedCount} partner location(s).`)
}

/**
 * Pick the best fulfillment provider for a country from the enabled list.
 */
function pickProvider(countryCode: string, enabledProviders: string[]): string {
  const country = countryCode.toLowerCase()

  // India → Delhivery
  if (country === "in" && enabledProviders.includes("delhivery_delhivery")) {
    return "delhivery_delhivery"
  }

  // EU → DHL
  const euCountries = new Set([
    "de", "fr", "it", "es", "nl", "be", "at", "pt", "ie", "fi",
    "se", "dk", "pl", "cz", "gr", "hu", "ro", "bg", "hr", "sk",
    "si", "lt", "lv", "ee", "lu", "mt", "cy", "gb", "ch", "no",
  ])
  if (euCountries.has(country) && enabledProviders.includes("dhl-express_dhl-express")) {
    return "dhl-express_dhl-express"
  }

  // US/CA → UPS or FedEx
  if (country === "us" || country === "ca") {
    if (enabledProviders.includes("ups_ups")) return "ups_ups"
    if (enabledProviders.includes("fedex_fedex")) return "fedex_fedex"
  }

  // Australia → AusPost
  if (country === "au" && enabledProviders.includes("auspost_auspost")) {
    return "auspost_auspost"
  }

  // Fallback to manual
  return "manual_manual"
}

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function debugShipping({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // 1. List all stores
  logger.info("=== STORES ===")
  const { data: stores } = await query.graph({
    entity: "stores",
    fields: ["id", "name", "default_sales_channel_id", "default_location_id"],
  })
  for (const s of (stores || [])) {
    const st = s as any
    logger.info(`  ${st.id} | ${st.name} | location: ${st.default_location_id || "NONE"} | sales_channel: ${st.default_sales_channel_id || "NONE"}`)
  }

  // 2. List all stock locations with fulfillment links
  logger.info("\n=== STOCK LOCATIONS ===")
  const { data: locations } = await query.graph({
    entity: "stock_locations",
    fields: [
      "id", "name",
      "fulfillment_sets.id", "fulfillment_sets.name", "fulfillment_sets.type",
      "fulfillment_sets.service_zones.id", "fulfillment_sets.service_zones.name",
      "fulfillment_sets.service_zones.geo_zones.*",
      "fulfillment_sets.service_zones.shipping_options.id",
      "fulfillment_sets.service_zones.shipping_options.name",
      "fulfillment_sets.service_zones.shipping_options.price_type",
      "fulfillment_sets.service_zones.shipping_options.provider_id",
      "fulfillment_sets.service_zones.shipping_options.shipping_profile_id",
      "fulfillment_sets.service_zones.shipping_options.prices.*",
      "fulfillment_sets.service_zones.shipping_options.rules.*",
      "fulfillment_providers.id",
      "sales_channels.id", "sales_channels.name",
    ],
  })

  for (const loc of (locations || [])) {
    const l = loc as any
    logger.info(`\n  Location: ${l.name} (${l.id})`)
    logger.info(`    Fulfillment providers: ${(l.fulfillment_providers || []).map((p: any) => p.id).join(", ") || "NONE"}`)
    logger.info(`    Sales channels: ${(l.sales_channels || []).map((sc: any) => `${sc.name} (${sc.id})`).join(", ") || "NONE"}`)

    for (const fs of (l.fulfillment_sets || [])) {
      logger.info(`    Fulfillment Set: ${fs.name} (${fs.id}) type=${fs.type}`)
      for (const sz of (fs.service_zones || [])) {
        const geoZones = (sz.geo_zones || []).map((g: any) => g.country_code).join(", ")
        logger.info(`      Service Zone: ${sz.name} (${sz.id}) countries=[${geoZones}]`)
        for (const so of (sz.shipping_options || [])) {
          const prices = (so.prices || []).map((p: any) => `${p.amount} ${p.currency_code || ""}`).join(", ")
          const rules = (so.rules || []).map((r: any) => `${r.attribute}=${r.value}`).join(", ")
          logger.info(`        Shipping Option: ${so.name} (${so.id}) provider=${so.provider_id} price_type=${so.price_type} profile=${so.shipping_profile_id}`)
          logger.info(`          Prices: ${prices || "NONE"}`)
          logger.info(`          Rules: ${rules || "NONE"}`)
        }
        if (!(sz.shipping_options?.length)) {
          logger.info(`        ❌ NO SHIPPING OPTIONS in this zone`)
        }
      }
      if (!(fs.service_zones?.length)) {
        logger.info(`      ❌ NO SERVICE ZONES in this fulfillment set`)
      }
    }
    if (!(l.fulfillment_sets?.length)) {
      logger.info(`    ❌ NO FULFILLMENT SETS linked to this location`)
    }
  }

  // 3. Check shipping profiles
  logger.info("\n=== SHIPPING PROFILES ===")
  const fulfillmentService = container.resolve(Modules.FULFILLMENT) as any
  const profiles = await fulfillmentService.listShippingProfiles({}, { take: 10 })
  for (const p of (profiles || [])) {
    logger.info(`  ${p.id} | ${p.name} | type=${p.type}`)
  }

  // 4. Check regions and their payment providers
  logger.info("\n=== REGIONS ===")
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "countries.*"],
  })
  for (const r of (regions || [])) {
    const reg = r as any
    const countries = (reg.countries || []).map((c: any) => c.iso_2).join(", ")
    logger.info(`  ${reg.id} | ${reg.name} | ${reg.currency_code} | countries=[${countries}]`)
  }

  // 5. Check cart shipping requirements
  logger.info("\n=== CARTS (last 3) ===")
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id", "region_id", "currency_code",
      "shipping_address.country_code",
      "shipping_methods.id", "shipping_methods.name",
      "sales_channel_id",
    ],
    filters: {},
  })
  for (const c of ((carts || []) as any[]).slice(-3)) {
    logger.info(`  Cart ${c.id} | region=${c.region_id} | currency=${c.currency_code} | country=${c.shipping_address?.country_code || "NONE"} | sales_channel=${c.sales_channel_id || "NONE"}`)
    logger.info(`    Shipping methods: ${(c.shipping_methods || []).map((m: any) => m.name).join(", ") || "NONE"}`)
  }

  logger.info("\nDone.")
}

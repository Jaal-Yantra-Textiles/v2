import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"

/**
 * Backfill international shipping coverage onto every partner store location.
 *
 * WHY
 * ---
 * Partner storefronts are provisioned with an "IN Shipping Zone" covering only
 * `[in]` (Delhivery/manual). An overseas buyer (Europe / America / Indonesia /
 * Australia region) therefore sees ZERO shipping options and cannot check out.
 * Several partner locations have no shipping fulfillment set at all.
 *
 * This one-shot reconciles every partner location so it carries a dedicated
 * "International" service zone spanning all non-India country codes, with:
 *   - `manual_manual`          → a flat fallback option (always created; keeps
 *                                intl checkout from dead-ending even before a
 *                                carrier is credentialed). Prices are editable
 *                                placeholders — see DEFAULT_MANUAL_PRICES.
 *   - `dhl-express_dhl-express`→ a CALCULATED option (live DHL rates via the
 *                                provider's getRates). Only created when the DHL
 *                                provider is actually registered/enabled (its
 *                                creds are set in the env). Until then the DHL
 *                                tier is skipped and this job is safe to run for
 *                                the manual baseline alone; re-run after DHL is
 *                                wired to add the DHL options.
 *
 * It never touches a partner's existing domestic (IN) zone — it only adds and
 * reconciles the "International" zone it owns, so it is idempotent and re-runnable.
 *
 * Run:
 *   npx medusa exec ./src/scripts/backfill-partner-international-shipping.ts
 *
 * Dry run (mutates nothing, logs WOULD…):
 *   DRY_RUN=1 npx medusa exec ./src/scripts/backfill-partner-international-shipping.ts
 *   npx medusa exec ./src/scripts/backfill-partner-international-shipping.ts -- --dry-run
 *
 * Override the manual fallback flat rates (major units, keyed by currency):
 *   INTL_MANUAL_PRICES='{"eur":25,"usd":30,"aud":45,"idr":450000}' npx medusa exec …
 *
 * Companion to fix-partner-fulfillment-sets.ts (which only provisions the home
 * country) and backfill-store-currencies-from-partner-regions.ts (the DP pattern).
 */

const INTL_ZONE_NAME = "International"
const MANUAL_PROVIDER = "manual_manual"
const DHL_PROVIDER = "dhl-express_dhl-express"

// Editable placeholder flat rates for the MANUAL fallback option, in MAJOR
// units, keyed by region currency. DHL is the primary carrier (live calculated
// rates); manual exists only so intl checkout never dead-ends. Operators can
// edit these per shipping-option afterward, or override the whole map via the
// INTL_MANUAL_PRICES env var. `usd` is the fallback when a currency is unlisted.
const DEFAULT_MANUAL_PRICES: Record<string, number> = {
  usd: 30,
  eur: 25,
  gbp: 22,
  aud: 45,
  cad: 40,
  idr: 450000,
}

const enabledRule = { attribute: "enabled_in_store", value: '"true"', operator: "eq" }
const notReturnRule = { attribute: "is_return", value: "false", operator: "eq" }

export default async function backfillPartnerInternationalShipping({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
  const fulfillmentService = container.resolve(Modules.FULFILLMENT) as any

  const dryRun = (args ?? []).includes("--dry-run") || process.env.DRY_RUN === "1"
  if (dryRun) logger.info("[intl-shipping] DRY RUN — nothing will be mutated.")

  const manualPrices = { ...DEFAULT_MANUAL_PRICES }
  if (process.env.INTL_MANUAL_PRICES) {
    try {
      const override = JSON.parse(process.env.INTL_MANUAL_PRICES)
      for (const [k, v] of Object.entries(override)) {
        if (typeof v === "number") manualPrices[k.toLowerCase()] = v
      }
    } catch (e: any) {
      logger.warn(`[intl-shipping] INTL_MANUAL_PRICES is not valid JSON — ignoring (${e.message})`)
    }
  }

  // 1. Which fulfillment providers are actually registered/enabled?
  const { data: providers } = await query.graph({
    entity: "fulfillment_provider",
    fields: ["id", "is_enabled"],
  })
  const enabled = new Set(
    (providers || []).filter((p: any) => p.is_enabled !== false).map((p: any) => p.id)
  )
  if (!enabled.has(MANUAL_PROVIDER)) {
    logger.error(`[intl-shipping] '${MANUAL_PROVIDER}' provider not enabled — cannot provision. Aborting.`)
    process.exitCode = 1
    return
  }
  const dhlEnabled = enabled.has(DHL_PROVIDER)
  if (dhlEnabled) {
    logger.info(`[intl-shipping] DHL is enabled — will provision calculated DHL options.`)
  } else {
    logger.warn(
      `[intl-shipping] DHL ('${DHL_PROVIDER}') is NOT enabled (DHL_API_KEY unset in this env). ` +
        `Provisioning the MANUAL tier only. Wire DHL creds + redeploy, then re-run to add DHL options.`
    )
  }

  // 2. Default shipping profile (shipping options require one; it's global).
  let profileId: string | undefined
  const defaultProfiles = await fulfillmentService.listShippingProfiles({ type: "default" }, { take: 1 })
  profileId = defaultProfiles?.[0]?.id
  if (!profileId) {
    const anyProfiles = await fulfillmentService.listShippingProfiles({}, { take: 1 })
    profileId = anyProfiles?.[0]?.id
  }
  if (!profileId) {
    logger.error("[intl-shipping] No shipping profile found. Aborting.")
    process.exitCode = 1
    return
  }

  // 3. Build the international coverage set from regions: every non-India
  //    region's countries + currencies. The India region (countries include
  //    "in") is excluded — its domestic zone stays untouched.
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "countries.iso_2"],
  })
  const intlCountries = new Set<string>()
  const intlCurrencies = new Set<string>()
  for (const r of (regions || []) as any[]) {
    const ccs = (r.countries || [])
      .map((c: any) => (c.iso_2 || "").toLowerCase())
      .filter(Boolean)
    if (ccs.includes("in")) continue // the India region — leave domestic alone
    ccs.forEach((c: string) => intlCountries.add(c))
    if (r.currency_code) intlCurrencies.add(r.currency_code.toLowerCase())
  }
  intlCountries.delete("in") // defensive
  if (!intlCountries.size) {
    logger.error("[intl-shipping] No international regions/countries found. Aborting.")
    process.exitCode = 1
    return
  }
  const geoZones = [...intlCountries]
    .sort()
    .map((cc) => ({ country_code: cc, type: "country" as const }))
  const manualPriceArr = [...intlCurrencies].map((cur) => ({
    currency_code: cur,
    amount: manualPrices[cur] ?? manualPrices["usd"] ?? 30,
  }))
  logger.info(
    `[intl-shipping] International coverage → ${geoZones.length} countries; ` +
      `manual currencies [${[...intlCurrencies].join(", ")}].`
  )

  // 4. Every partner store.
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "name", "stores.id", "stores.name", "stores.default_location_id"],
  })

  const counters = { locations: 0, zonesCreated: 0, setsCreated: 0, manualOpts: 0, dhlOpts: 0, skipped: 0 }
  const errors: Array<{ partner: string; location: string; error: string }> = []

  const buildOption = (serviceZoneId: string, kind: "manual" | "dhl") => {
    if (kind === "manual") {
      return {
        name: "International Shipping",
        price_type: "flat" as const,
        provider_id: MANUAL_PROVIDER,
        service_zone_id: serviceZoneId,
        shipping_profile_id: profileId!,
        type: {
          label: "International",
          description: "International shipping (self-managed / manual)",
          code: "international-standard",
        },
        prices: manualPriceArr,
        data: {},
        rules: [enabledRule, notReturnRule],
      }
    }
    return {
      name: "DHL Express Worldwide",
      price_type: "calculated" as const,
      provider_id: DHL_PROVIDER,
      service_zone_id: serviceZoneId,
      shipping_profile_id: profileId!,
      type: {
        label: "DHL Express",
        description: "DHL Express Worldwide — live rates",
        code: "dhl-express-worldwide",
      },
      prices: [],
      data: { product_code: "P" },
      rules: [enabledRule, notReturnRule],
    }
  }

  for (const partner of (partners || []) as any[]) {
    for (const store of (partner.stores || []) as any[]) {
      const locationId = store.default_location_id
      const tag = `${partner.name} / ${store.name}`
      if (!locationId) {
        logger.warn(`[intl-shipping] ${tag} — no default location, skipping.`)
        counters.skipped++
        continue
      }
      counters.locations++

      try {
        const { data: locs } = await query.graph({
          entity: "stock_locations",
          fields: [
            "id",
            "name",
            "fulfillment_sets.id",
            "fulfillment_sets.type",
            "fulfillment_sets.service_zones.id",
            "fulfillment_sets.service_zones.name",
            "fulfillment_sets.service_zones.geo_zones.country_code",
            "fulfillment_sets.service_zones.shipping_options.id",
            "fulfillment_sets.service_zones.shipping_options.provider_id",
            "fulfillment_providers.id",
          ],
          filters: { id: locationId },
        })
        const loc = locs?.[0] as any
        if (!loc) {
          logger.warn(`[intl-shipping] ${tag} — location ${locationId} not found, skipping.`)
          counters.skipped++
          continue
        }

        const suffix = String(locationId).slice(-8)
        const sets = loc.fulfillment_sets || []
        let shippingSet = sets.find((s: any) => s.type === "shipping")

        // Ensure a provider is linked to the location before its option is used.
        const linkedProviders = new Set((loc.fulfillment_providers || []).map((p: any) => p.id))
        const ensureProviderLink = async (pid: string) => {
          if (linkedProviders.has(pid)) return
          if (dryRun) {
            logger.info(`[intl-shipping] ${tag} — WOULD link provider ${pid} to location`)
            return
          }
          try {
            await remoteLink.create({
              [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
              [Modules.FULFILLMENT]: { fulfillment_provider_id: pid },
            })
            linkedProviders.add(pid)
          } catch (e: any) {
            // Link may already exist (race / prior partial run) — non-fatal.
            logger.info(`[intl-shipping] ${tag} — provider ${pid} link note: ${e.message}`)
          }
        }

        // Resolve (or create) the International service zone.
        let intlZoneId: string | undefined
        let existingOptionProviders = new Set<string>()

        if (!shippingSet) {
          if (dryRun) {
            logger.info(`[intl-shipping] ${tag} — WOULD create shipping set + '${INTL_ZONE_NAME}' zone (${geoZones.length} countries)`)
          } else {
            const createdSet = await fulfillmentService.createFulfillmentSets({
              name: `Shipping (${suffix})`,
              type: "shipping",
              service_zones: [{ name: INTL_ZONE_NAME, geo_zones: geoZones }],
            })
            await remoteLink.create({
              [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
              [Modules.FULFILLMENT]: { fulfillment_set_id: createdSet.id },
            })
            intlZoneId = createdSet.service_zones?.[0]?.id
            counters.setsCreated++
            counters.zonesCreated++
            logger.info(`[intl-shipping] ${tag} — created shipping set ${createdSet.id} + International zone`)
          }
        } else {
          const intlZone = (shippingSet.service_zones || []).find((z: any) => z.name === INTL_ZONE_NAME)
          if (!intlZone) {
            if (dryRun) {
              logger.info(`[intl-shipping] ${tag} — WOULD add '${INTL_ZONE_NAME}' zone to existing shipping set (${geoZones.length} countries)`)
            } else {
              const zone = await fulfillmentService.createServiceZones({
                name: INTL_ZONE_NAME,
                fulfillment_set_id: shippingSet.id,
                geo_zones: geoZones,
              })
              intlZoneId = Array.isArray(zone) ? zone[0]?.id : zone?.id
              counters.zonesCreated++
              logger.info(`[intl-shipping] ${tag} — added International zone to shipping set ${shippingSet.id}`)
            }
          } else {
            intlZoneId = intlZone.id
            existingOptionProviders = new Set(
              (intlZone.shipping_options || []).map((o: any) => o.provider_id)
            )
            // Reconcile coverage: add any newly-supported countries (non-fatal).
            const have = new Set((intlZone.geo_zones || []).map((g: any) => g.country_code))
            const missing = [...intlCountries].filter((c) => !have.has(c))
            if (missing.length) {
              if (dryRun) {
                logger.info(`[intl-shipping] ${tag} — WOULD add ${missing.length} countries to International zone`)
              } else {
                try {
                  await fulfillmentService.updateServiceZones(intlZone.id, { geo_zones: geoZones })
                  logger.info(`[intl-shipping] ${tag} — reconciled International zone (+${missing.length} countries)`)
                } catch (e: any) {
                  logger.warn(`[intl-shipping] ${tag} — geo-zone reconcile skipped: ${e.message}`)
                }
              }
            }
          }
        }

        if (dryRun) {
          // Report which options WOULD be created.
          logger.info(
            `[intl-shipping] ${tag} — WOULD ensure manual option${dhlEnabled ? " + DHL calculated option" : " (DHL skipped — not enabled)"}`
          )
          continue
        }

        if (!intlZoneId) {
          logger.warn(`[intl-shipping] ${tag} — could not resolve International zone id, skipping options.`)
          continue
        }

        // Ensure provider links, then create the missing options.
        await ensureProviderLink(MANUAL_PROVIDER)
        if (!existingOptionProviders.has(MANUAL_PROVIDER)) {
          await createShippingOptionsWorkflow(container).run({
            input: [buildOption(intlZoneId, "manual")] as any,
          })
          counters.manualOpts++
          logger.info(`[intl-shipping] ${tag} — created manual International option`)
        }

        if (dhlEnabled) {
          await ensureProviderLink(DHL_PROVIDER)
          if (!existingOptionProviders.has(DHL_PROVIDER)) {
            await createShippingOptionsWorkflow(container).run({
              input: [buildOption(intlZoneId, "dhl")] as any,
            })
            counters.dhlOpts++
            logger.info(`[intl-shipping] ${tag} — created DHL Express calculated option`)
          }
        }
      } catch (e: any) {
        logger.error(`[intl-shipping] ${tag} — FAILED: ${e.message}`)
        errors.push({ partner: partner.name, location: locationId, error: e.message })
      }
    }
  }

  logger.info(
    `[intl-shipping] Done${dryRun ? " (dry-run)" : ""}. ` +
      `locations=${counters.locations} setsCreated=${counters.setsCreated} ` +
      `zonesCreated=${counters.zonesCreated} manualOpts=${counters.manualOpts} ` +
      `dhlOpts=${counters.dhlOpts} skipped=${counters.skipped} errors=${errors.length}`
  )
  if (errors.length) {
    for (const e of errors) logger.error(`[intl-shipping]   ✗ ${e.partner} (${e.location}): ${e.error}`)
    process.exitCode = 1
  }
}

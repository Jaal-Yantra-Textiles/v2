import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"

/**
 * Backfill shipping coverage onto every partner store location (#954).
 *
 * PROBLEM
 * -------
 * Partner storefronts are provisioned inconsistently: most have an India-only
 * shipping zone (so an overseas buyer sees ZERO options and cannot check out),
 * several locations have shipping sets with no options, and a few have no
 * fulfillment set at all. This one-shot reconciles every partner location to a
 * clean two-zone matrix:
 *
 *   ┌────────────────────┬───────────────────┬────────────────────────────────┐
 *   │ Zone               │ Countries         │ Options                        │
 *   ├────────────────────┼───────────────────┼────────────────────────────────┤
 *   │ Domestic (India)   │ in                │ manual (flat INR, "local")     │
 *   │                    │                   │ + Delhivery (calculated)       │
 *   │ International      │ all non-IN region │ manual (flat per-currency)     │
 *   │                    │ countries         │ + DHL Express (calculated)     │
 *   └────────────────────┴───────────────────┴────────────────────────────────┘
 *
 * Delhivery is India-only; DHL is international-only. Manual is the universal
 * fallback on BOTH zones so checkout never dead-ends. Carrier options use
 * `price_type: "calculated"` (live rates via each provider's getRates); manual
 * options are flat with editable placeholder rates (see DEFAULT_MANUAL_PRICES).
 *
 * Carrier tiers are GATED on the provider actually being registered/enabled in
 * this env (DHL only registers when DHL_API_KEY is set — medusa-config.prod.ts).
 * If a carrier isn't enabled its option is skipped; the manual tier always runs.
 * Re-run after wiring a carrier's creds to add its options.
 *
 * The job REUSES a partner's existing India zone (any zone covering exactly
 * [in]) rather than creating a duplicate, and manages a canonical "International"
 * zone by name — so it is idempotent and re-runnable.
 *
 * Run:
 *   npx medusa exec ./src/scripts/backfill-partner-shipping-options.ts
 * Dry run (mutates nothing):
 *   DRY_RUN=1 npx medusa exec ./src/scripts/backfill-partner-shipping-options.ts
 *   npx medusa exec ./src/scripts/backfill-partner-shipping-options.ts -- --dry-run
 * Override manual flat rates (major units, keyed by currency):
 *   INTL_MANUAL_PRICES='{"eur":25,"usd":30,"aud":45,"idr":450000,"inr":60}' npx medusa exec …
 */

const DOMESTIC_ZONE_NAME = "Domestic (India)"
const INTL_ZONE_NAME = "International"
const INDIA_CC = "in"

const MANUAL_PROVIDER = "manual_manual"
const DHL_PROVIDER = "dhl-express_dhl-express"
const DELHIVERY_PROVIDER = "delhivery_delhivery"

// Editable placeholder flat rates for the MANUAL options, MAJOR units, keyed by
// region currency. Carriers (Delhivery/DHL) are the primary priced options via
// live calculated rates; manual exists so checkout never dead-ends. Override the
// whole map via INTL_MANUAL_PRICES. `usd` is the fallback for unlisted currencies.
const DEFAULT_MANUAL_PRICES: Record<string, number> = {
  inr: 60,
  usd: 30,
  eur: 25,
  gbp: 22,
  aud: 45,
  cad: 40,
  idr: 450000,
}

const enabledRule = { attribute: "enabled_in_store", value: '"true"', operator: "eq" }
const notReturnRule = { attribute: "is_return", value: "false", operator: "eq" }

type OptionSpec = {
  name: string
  provider_id: string
  price_type: "flat" | "calculated"
  prices: Array<{ currency_code: string; amount: number }>
  data: Record<string, unknown>
  typeCode: string
  typeLabel: string
  typeDescription: string
}

export default async function backfillPartnerShippingOptions({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
  const fulfillmentService = container.resolve(Modules.FULFILLMENT) as any

  const dryRun = (args ?? []).includes("--dry-run") || process.env.DRY_RUN === "1"
  if (dryRun) logger.info("[ship-backfill] DRY RUN — nothing will be mutated.")

  const manualPrices = { ...DEFAULT_MANUAL_PRICES }
  if (process.env.INTL_MANUAL_PRICES) {
    try {
      const override = JSON.parse(process.env.INTL_MANUAL_PRICES)
      for (const [k, v] of Object.entries(override)) {
        if (typeof v === "number") manualPrices[k.toLowerCase()] = v
      }
    } catch (e: any) {
      logger.warn(`[ship-backfill] INTL_MANUAL_PRICES not valid JSON — ignoring (${e.message})`)
    }
  }
  const manualPrice = (cur: string) => manualPrices[cur] ?? manualPrices["usd"] ?? 30

  // 1. Which fulfillment providers are actually registered/enabled?
  const { data: providers } = await query.graph({
    entity: "fulfillment_provider",
    fields: ["id", "is_enabled"],
  })
  const enabled = new Set(
    (providers || []).filter((p: any) => p.is_enabled !== false).map((p: any) => p.id)
  )
  if (!enabled.has(MANUAL_PROVIDER)) {
    logger.error(`[ship-backfill] '${MANUAL_PROVIDER}' not enabled — cannot provision. Aborting.`)
    process.exitCode = 1
    return
  }
  const dhlEnabled = enabled.has(DHL_PROVIDER)
  const delhiveryEnabled = enabled.has(DELHIVERY_PROVIDER)
  logger.info(
    `[ship-backfill] providers → manual:yes delhivery:${delhiveryEnabled ? "yes" : "NO"} dhl:${dhlEnabled ? "yes" : "NO"}` +
      (dhlEnabled ? "" : " (DHL_API_KEY unset — international carrier tier skipped; re-run after wiring)")
  )

  // 2. Default shipping profile (global; options require one).
  let profileId: string | undefined = (
    await fulfillmentService.listShippingProfiles({ type: "default" }, { take: 1 })
  )?.[0]?.id
  if (!profileId) {
    profileId = (await fulfillmentService.listShippingProfiles({}, { take: 1 }))?.[0]?.id
  }
  if (!profileId) {
    logger.error("[ship-backfill] No shipping profile found. Aborting.")
    process.exitCode = 1
    return
  }

  // 3. Build international coverage from regions (every non-India region's
  //    countries + currencies). The India region (countries include "in") is
  //    the domestic zone.
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "countries.iso_2"],
  })
  const intlCountries = new Set<string>()
  const intlCurrencies = new Set<string>()
  for (const r of (regions || []) as any[]) {
    const ccs = (r.countries || []).map((c: any) => (c.iso_2 || "").toLowerCase()).filter(Boolean)
    if (ccs.includes(INDIA_CC)) continue // India region → domestic
    ccs.forEach((c: string) => intlCountries.add(c))
    if (r.currency_code) intlCurrencies.add(r.currency_code.toLowerCase())
  }
  intlCountries.delete(INDIA_CC)
  const intlGeoZones = [...intlCountries].sort().map((cc) => ({ country_code: cc, type: "country" as const }))
  const domesticGeoZones = [{ country_code: INDIA_CC, type: "country" as const }]
  if (!intlCountries.size) {
    logger.warn("[ship-backfill] No international regions found — provisioning domestic only.")
  }
  logger.info(
    `[ship-backfill] coverage → domestic [in]; international ${intlGeoZones.length} countries ` +
      `[currencies ${[...intlCurrencies].join(", ") || "none"}]`
  )

  // Option specs per zone (prices filled at build time).
  const specs = {
    manualLocal: (): OptionSpec => ({
      name: "Domestic Shipping",
      provider_id: MANUAL_PROVIDER,
      price_type: "flat",
      prices: [{ currency_code: "inr", amount: manualPrice("inr") }],
      data: {},
      typeCode: "domestic-standard",
      typeLabel: "Domestic",
      typeDescription: "Domestic shipping (self-managed / manual)",
    }),
    delhivery: (): OptionSpec => ({
      name: "Delhivery",
      provider_id: DELHIVERY_PROVIDER,
      price_type: "calculated",
      prices: [],
      data: {},
      typeCode: "delhivery-standard",
      typeLabel: "Delhivery",
      typeDescription: "Delhivery — live rates (India)",
    }),
    manualIntl: (): OptionSpec => ({
      name: "International Shipping",
      provider_id: MANUAL_PROVIDER,
      price_type: "flat",
      prices: [...intlCurrencies].map((cur) => ({ currency_code: cur, amount: manualPrice(cur) })),
      data: {},
      typeCode: "international-standard",
      typeLabel: "International",
      typeDescription: "International shipping (self-managed / manual)",
    }),
    dhl: (): OptionSpec => ({
      name: "DHL Express Worldwide",
      provider_id: DHL_PROVIDER,
      price_type: "calculated",
      prices: [],
      data: { product_code: "P" },
      typeCode: "dhl-express-worldwide",
      typeLabel: "DHL Express",
      typeDescription: "DHL Express Worldwide — live rates",
    }),
  }

  // 4. Every partner store.
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "name", "stores.id", "stores.name", "stores.default_location_id"],
  })

  const counters = { locations: 0, setsCreated: 0, zonesCreated: 0, optsCreated: 0, skipped: 0 }
  const errors: Array<{ tag: string; error: string }> = []

  for (const partner of (partners || []) as any[]) {
    for (const store of (partner.stores || []) as any[]) {
      const locationId = store.default_location_id
      const tag = `${partner.name} / ${store.name}`
      if (!locationId) {
        logger.warn(`[ship-backfill] ${tag} — no default location, skipping.`)
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
            "fulfillment_sets.service_zones.shipping_options.provider_id",
            "fulfillment_providers.id",
          ],
          filters: { id: locationId },
        })
        const loc = locs?.[0] as any
        if (!loc) {
          logger.warn(`[ship-backfill] ${tag} — location ${locationId} not found, skipping.`)
          counters.skipped++
          continue
        }

        const suffix = String(locationId).slice(-8)
        const sets = loc.fulfillment_sets || []
        let shippingSet = sets.find((s: any) => s.type === "shipping")

        const linkedProviders = new Set((loc.fulfillment_providers || []).map((p: any) => p.id))
        const ensureProviderLink = async (pid: string) => {
          if (linkedProviders.has(pid)) return
          if (dryRun) {
            logger.info(`[ship-backfill] ${tag} — WOULD link provider ${pid}`)
            return
          }
          try {
            await remoteLink.create({
              [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
              [Modules.FULFILLMENT]: { fulfillment_provider_id: pid },
            })
            linkedProviders.add(pid)
          } catch (e: any) {
            logger.info(`[ship-backfill] ${tag} — provider ${pid} link note: ${e.message}`)
          }
        }

        // --- Create the shipping set if the location has none ---
        if (!shippingSet) {
          const nestedZones = [{ name: DOMESTIC_ZONE_NAME, geo_zones: domesticGeoZones }] as any[]
          if (intlGeoZones.length) nestedZones.push({ name: INTL_ZONE_NAME, geo_zones: intlGeoZones })
          if (dryRun) {
            logger.info(`[ship-backfill] ${tag} — WOULD create shipping set + ${nestedZones.length} zone(s)`)
          } else {
            const created = await fulfillmentService.createFulfillmentSets({
              name: `Shipping (${suffix})`,
              type: "shipping",
              service_zones: nestedZones,
            })
            await remoteLink.create({
              [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
              [Modules.FULFILLMENT]: { fulfillment_set_id: created.id },
            })
            shippingSet = created
            counters.setsCreated++
            counters.zonesCreated += nestedZones.length
            logger.info(`[ship-backfill] ${tag} — created shipping set ${created.id} + zones`)
          }
        }

        // --- Resolve (or create) each zone, then ensure its options ---
        const zonesById = new Map<string, { id: string; providers: Set<string> }>()
        const zoneList = (shippingSet?.service_zones || []) as any[]
        const geoSet = (z: any) => new Set((z.geo_zones || []).map((g: any) => g.country_code))

        // Domestic: reuse any existing zone covering exactly [in]; else create.
        let domesticZone = zoneList.find((z) => {
          const s = geoSet(z)
          return s.size === 1 && s.has(INDIA_CC)
        }) || zoneList.find((z) => z.name === DOMESTIC_ZONE_NAME)

        // International: reuse the canonical-named zone; else any non-India multi-country zone.
        let intlZone = zoneList.find((z) => z.name === INTL_ZONE_NAME)

        const ensureZone = async (
          existing: any,
          name: string,
          geo: Array<{ country_code: string; type: "country" }>
        ): Promise<{ id: string; providers: Set<string> } | null> => {
          if (existing) {
            // Reconcile international coverage (add newly-supported countries).
            if (name === INTL_ZONE_NAME) {
              const have = geoSet(existing)
              const missing = geo.filter((g) => !have.has(g.country_code))
              if (missing.length && !dryRun) {
                try {
                  await fulfillmentService.updateServiceZones(existing.id, { geo_zones: geo })
                  logger.info(`[ship-backfill] ${tag} — reconciled ${name} (+${missing.length} countries)`)
                } catch (e: any) {
                  logger.warn(`[ship-backfill] ${tag} — ${name} geo reconcile skipped: ${e.message}`)
                }
              }
            }
            return {
              id: existing.id,
              providers: new Set((existing.shipping_options || []).map((o: any) => o.provider_id)),
            }
          }
          if (!shippingSet) return null // dry-run with no set yet
          if (dryRun) {
            logger.info(`[ship-backfill] ${tag} — WOULD create ${name} zone (${geo.length} countries)`)
            return null
          }
          const z = await fulfillmentService.createServiceZones({
            name,
            fulfillment_set_id: shippingSet.id,
            geo_zones: geo,
          })
          const zone = Array.isArray(z) ? z[0] : z
          counters.zonesCreated++
          logger.info(`[ship-backfill] ${tag} — created ${name} zone`)
          return { id: zone.id, providers: new Set() }
        }

        const domestic = await ensureZone(domesticZone, DOMESTIC_ZONE_NAME, domesticGeoZones)
        if (domestic) zonesById.set("domestic", domestic)
        if (intlGeoZones.length) {
          const intl = await ensureZone(intlZone, INTL_ZONE_NAME, intlGeoZones)
          if (intl) zonesById.set("international", intl)
        }

        // --- Ensure options on each resolved zone ---
        const ensureOption = async (
          zone: { id: string; providers: Set<string> },
          spec: OptionSpec
        ) => {
          if (zone.providers.has(spec.provider_id)) return
          if (dryRun) {
            logger.info(`[ship-backfill] ${tag} — WOULD create '${spec.name}' (${spec.provider_id})`)
            return
          }
          await ensureProviderLink(spec.provider_id)
          await createShippingOptionsWorkflow(container).run({
            input: [
              {
                name: spec.name,
                price_type: spec.price_type,
                provider_id: spec.provider_id,
                service_zone_id: zone.id,
                shipping_profile_id: profileId!,
                type: { label: spec.typeLabel, description: spec.typeDescription, code: spec.typeCode },
                prices: spec.prices,
                data: spec.data,
                rules: [enabledRule, notReturnRule],
              },
            ] as any,
          })
          zone.providers.add(spec.provider_id)
          counters.optsCreated++
          logger.info(`[ship-backfill] ${tag} — created '${spec.name}'`)
        }

        const domesticZ = zonesById.get("domestic")
        if (domesticZ) {
          await ensureOption(domesticZ, specs.manualLocal())
          if (delhiveryEnabled) await ensureOption(domesticZ, specs.delhivery())
        }
        const intlZ = zonesById.get("international")
        if (intlZ) {
          await ensureOption(intlZ, specs.manualIntl())
          if (dhlEnabled) await ensureOption(intlZ, specs.dhl())
        }
      } catch (e: any) {
        logger.error(`[ship-backfill] ${tag} — FAILED: ${e.message}`)
        errors.push({ tag, error: e.message })
      }
    }
  }

  logger.info(
    `[ship-backfill] Done${dryRun ? " (dry-run)" : ""}. ` +
      `locations=${counters.locations} setsCreated=${counters.setsCreated} ` +
      `zonesCreated=${counters.zonesCreated} optsCreated=${counters.optsCreated} ` +
      `skipped=${counters.skipped} errors=${errors.length}`
  )
  if (errors.length) {
    for (const e of errors) logger.error(`[ship-backfill]   ✗ ${e.tag}: ${e.error}`)
    process.exitCode = 1
  }
}

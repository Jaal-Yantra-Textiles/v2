import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"
import { z } from "@medusajs/framework/zod"

import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #457 Data Plumbing — backfill partner storefront shipping coverage (#954/#649).
 *
 * Guarded, UI-runnable, ops_audit-tracked version of
 * `src/scripts/backfill-partner-shipping-options.ts`. Reconciles every partner
 * store location to a two-zone matrix so overseas buyers can check out:
 *
 *   Domestic (India)  → [in]              manual (flat, tiered) + Delhivery (calculated)
 *   International      → all non-IN region manual (flat per-currency, tiered) + DHL (calculated)
 *
 * WHY per-location NAME + type.code SUFFIX (critical):
 *   Shipping option `name` and shipping_option_type `code` collide globally
 *   when reused verbatim across locations — the second partner location fails
 *   to provision. Every created fulfillment-set / service-zone / shipping-option
 *   name and every shipping_option_type code is suffixed with the location's
 *   short id (`· ab12cd34`) so they are globally unique. Idempotency does NOT
 *   depend on the suffix (options dedup by provider_id per zone, zones by geo),
 *   so the suffix is free to be unique-per-location.
 *
 * Carrier tiers are gated on the provider being registered/enabled in this env
 * (Delhivery = India, DHL = international). If a carrier isn't enabled its option
 * is skipped; the manual tier always runs. Re-run after wiring a carrier's creds.
 *
 * Dry-run previews every set/zone/option it would create without persisting.
 */

/** Hard cap on partner stores scanned in one call. */
export const MAX_SHIPPING_BACKFILL_SCAN = 5000

const DOMESTIC_ZONE_NAME = "Domestic (India)"
const INTL_ZONE_NAME = "International"
const INDIA_CC = "in"

const MANUAL_PROVIDER = "manual_manual"
const DHL_PROVIDER = "dhl-express_dhl-express"
const DELHIVERY_PROVIDER = "delhivery_delhivery"

/**
 * REAL flat manual rates (major currency units), keyed by region currency.
 * `base` is the default shipping amount; `freeAbove` is the cart item_total at or
 * above which shipping becomes free (a Medusa `item_total >= N` price rule — the
 * "price range"/tiered feature). Domestic is India (INR); everything else is a
 * true cross-border rate. `usd` is the fallback for unlisted currencies.
 */
export const DOMESTIC_MANUAL_RATES: Record<string, { base: number; freeAbove: number }> = {
  inr: { base: 99, freeAbove: 2999 },
}
export const INTL_MANUAL_RATES: Record<string, { base: number; freeAbove: number }> = {
  usd: { base: 39, freeAbove: 350 },
  eur: { base: 35, freeAbove: 300 },
  gbp: { base: 30, freeAbove: 275 },
  aud: { base: 55, freeAbove: 450 },
  cad: { base: 50, freeAbove: 400 },
  inr: { base: 3200, freeAbove: 25000 },
  idr: { base: 550000, freeAbove: 5000000 },
}

const enabledRule = { attribute: "enabled_in_store", value: "true", operator: "eq" as const }
const notReturnRule = { attribute: "is_return", value: "false", operator: "eq" as const }

const backfillParamsSchema = z.object({
  /** Restrict to a single partner (default: all). */
  partner_id: z.string().min(1).optional(),
  /** Max partner stores to scan in one call. */
  limit: z.number().int().positive().max(MAX_SHIPPING_BACKFILL_SCAN).optional().default(1000),
})

type TieredPrice = { currency_code: string; amount: number; rules?: any[] }

export type ShippingOptionSpec = {
  name: string
  provider_id: string
  price_type: "flat" | "calculated"
  prices: TieredPrice[]
  data: Record<string, unknown>
  typeCode: string
  typeLabel: string
  typeDescription: string
}

/** Short per-location token used to make names/codes globally unique. */
export const locationSuffix = (locationId: string): string =>
  String(locationId).replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "loc"

/**
 * Build the flat tiered price list for a manual option: a default `base` price
 * plus a `0` price gated on `item_total >= freeAbove` (free-shipping tier).
 */
const manualTieredPrices = (
  currencies: string[],
  rates: Record<string, { base: number; freeAbove: number }>
): TieredPrice[] => {
  const out: TieredPrice[] = []
  for (const cur of currencies) {
    const rate = rates[cur] ?? rates["usd"] ?? { base: 39, freeAbove: 350 }
    out.push({ currency_code: cur, amount: rate.base })
    out.push({
      currency_code: cur,
      amount: 0,
      rules: [{ attribute: "item_total", operator: "gte" as const, value: rate.freeAbove }],
    })
  }
  return out
}

/**
 * PURE: the option specs for one location, with per-location name + type.code
 * suffixing and real tiered prices. Exported for unit testing.
 */
export function buildShippingSpecs(args: {
  suffix: string
  intlCurrencies: string[]
}): {
  manualLocal: ShippingOptionSpec
  delhivery: ShippingOptionSpec
  manualIntl: ShippingOptionSpec
  dhl: ShippingOptionSpec
} {
  const s = args.suffix
  return {
    manualLocal: {
      name: `Domestic Shipping · ${s}`,
      provider_id: MANUAL_PROVIDER,
      price_type: "flat",
      prices: manualTieredPrices(["inr"], DOMESTIC_MANUAL_RATES),
      data: {},
      typeCode: `domestic-standard-${s}`,
      typeLabel: "Domestic",
      typeDescription: "Domestic shipping (self-managed / manual)",
    },
    delhivery: {
      name: `Delhivery · ${s}`,
      provider_id: DELHIVERY_PROVIDER,
      price_type: "calculated",
      prices: [],
      data: {},
      typeCode: `delhivery-standard-${s}`,
      typeLabel: "Delhivery",
      typeDescription: "Delhivery — live rates (India)",
    },
    manualIntl: {
      name: `International Shipping · ${s}`,
      provider_id: MANUAL_PROVIDER,
      price_type: "flat",
      prices: manualTieredPrices(args.intlCurrencies, INTL_MANUAL_RATES),
      data: {},
      typeCode: `international-standard-${s}`,
      typeLabel: "International",
      typeDescription: "International shipping (self-managed / manual)",
    },
    dhl: {
      name: `DHL Express Worldwide · ${s}`,
      provider_id: DHL_PROVIDER,
      price_type: "calculated",
      prices: [],
      data: { product_code: "P" },
      typeCode: `dhl-express-worldwide-${s}`,
      typeLabel: "DHL Express",
      typeDescription: "DHL Express Worldwide — live rates",
    },
  }
}

export const backfillPartnerShippingOptionsJob: MaintenanceJob = {
  id: "backfill-partner-shipping-options",
  label: "Backfill partner storefront shipping (domestic + international)",
  description:
    `Provision two shipping zones on every partner store location so overseas buyers can check out: Domestic (India) = manual flat (tiered, free over ₹2999) + Delhivery live rates; International = manual flat per-currency (tiered) + DHL live rates. Carrier tiers only apply when the carrier is enabled (Delhivery/DHL); the manual tier always runs. Names and shipping_option_type codes are suffixed with the location id so they never collide globally across locations. Idempotent — dedups options by provider per zone, reuses the India geo zone. Dry-run previews every set/zone/option without persisting. Optionally scope to one partner_id; scans up to 'limit' stores (default 1000, max ${MAX_SHIPPING_BACKFILL_SCAN}).`,
  params: [
    {
      name: "partner_id",
      type: "string",
      required: false,
      description: "Restrict the backfill to a single partner (default: all partners)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max partner stores to scan in one call (default 1000, max ${MAX_SHIPPING_BACKFILL_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = backfillParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { partner_id, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
    const fulfillmentService: any = container.resolve(Modules.FULFILLMENT)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []

    // 1. Which fulfillment providers are enabled?
    const { data: providers } = await query.graph({
      entity: "fulfillment_provider",
      fields: ["id", "is_enabled"],
    })
    const enabled = new Set(
      (providers || []).filter((p: any) => p.is_enabled !== false).map((p: any) => p.id)
    )
    if (!enabled.has(MANUAL_PROVIDER)) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `'${MANUAL_PROVIDER}' fulfillment provider not enabled — cannot provision shipping.`
      )
    }
    const dhlEnabled = enabled.has(DHL_PROVIDER)
    const delhiveryEnabled = enabled.has(DELHIVERY_PROVIDER)

    // 2. Default shipping profile.
    let profileId: string | undefined = (
      await fulfillmentService.listShippingProfiles({ type: "default" }, { take: 1 })
    )?.[0]?.id
    if (!profileId) {
      profileId = (await fulfillmentService.listShippingProfiles({}, { take: 1 }))?.[0]?.id
    }
    if (!profileId) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "No shipping profile found.")
    }

    // 3. International coverage from non-India regions.
    const { data: regions } = await query.graph({
      entity: "region",
      fields: ["id", "name", "currency_code", "countries.iso_2"],
    })
    const intlCountries = new Set<string>()
    const intlCurrencies = new Set<string>()
    for (const r of (regions || []) as any[]) {
      const ccs = (r.countries || []).map((c: any) => (c.iso_2 || "").toLowerCase()).filter(Boolean)
      if (ccs.includes(INDIA_CC)) continue
      ccs.forEach((c: string) => intlCountries.add(c))
      if (r.currency_code) intlCurrencies.add(String(r.currency_code).toLowerCase())
    }
    intlCountries.delete(INDIA_CC)
    const intlGeoZones = [...intlCountries].sort().map((cc) => ({ country_code: cc, type: "country" as const }))
    const domesticGeoZones = [{ country_code: INDIA_CC, type: "country" as const }]

    // 4. Partner stores (optionally scoped).
    const partnerGraphArgs: Record<string, unknown> = {
      entity: "partners",
      fields: ["id", "name", "stores.id", "stores.name", "stores.default_location_id"],
      pagination: { take: limit },
    }
    if (partner_id) partnerGraphArgs.filters = { id: partner_id }
    const { data: partners } = await query.graph(partnerGraphArgs as any)

    let setsCreated = 0
    let zonesCreated = 0
    let optsCreated = 0
    let skipped = 0

    for (const partner of (partners || []) as any[]) {
      for (const store of (partner.stores || []) as any[]) {
        const locationId = store.default_location_id
        const tag = `${partner.name} / ${store.name}`
        if (!locationId) {
          skipped++
          continue
        }

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
            skipped++
            continue
          }

          const suffix = locationSuffix(locationId)
          const specs = buildShippingSpecs({ suffix, intlCurrencies: [...intlCurrencies] })
          const sets = loc.fulfillment_sets || []
          let shippingSet = sets.find((s: any) => s.type === "shipping")

          const linkedProviders = new Set((loc.fulfillment_providers || []).map((p: any) => p.id))
          const ensureProviderLink = async (pid: string) => {
            if (linkedProviders.has(pid)) return
            if (dry_run) return
            try {
              await remoteLink.create({
                [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
                [Modules.FULFILLMENT]: { fulfillment_provider_id: pid },
              })
              linkedProviders.add(pid)
            } catch {
              /* link may already exist — ignore */
            }
          }

          // Create the shipping set if the location has none.
          if (!shippingSet) {
            const nestedZones = [
              { name: `${DOMESTIC_ZONE_NAME} · ${suffix}`, geo_zones: domesticGeoZones },
            ] as any[]
            if (intlGeoZones.length) {
              nestedZones.push({ name: `${INTL_ZONE_NAME} · ${suffix}`, geo_zones: intlGeoZones })
            }
            changes.push({
              entity: "fulfillment_set",
              id: locationId,
              field: "shipping",
              before: "none",
              after: `set + ${nestedZones.length} zone(s)`,
            })
            if (!dry_run) {
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
              setsCreated++
              zonesCreated += nestedZones.length
            }
          }

          const zoneList = (shippingSet?.service_zones || []) as any[]
          const geoSet = (z: any) => new Set((z.geo_zones || []).map((g: any) => g.country_code))

          // Domestic: reuse the zone covering exactly [in]; else by suffixed/base name.
          const domesticZone =
            zoneList.find((z) => {
              const g = geoSet(z)
              return g.size === 1 && g.has(INDIA_CC)
            }) || zoneList.find((z) => String(z.name || "").startsWith(DOMESTIC_ZONE_NAME))

          // International: reuse any zone that covers a non-India country; else by name.
          const intlZone =
            zoneList.find((z) => {
              const g = geoSet(z)
              return g.size > 0 && ![...g].every((c) => c === INDIA_CC)
            }) || zoneList.find((z) => String(z.name || "").startsWith(INTL_ZONE_NAME))

          const ensureZone = async (
            existing: any,
            name: string,
            geo: Array<{ country_code: string; type: "country" }>
          ): Promise<{ id: string; providers: Set<string> } | null> => {
            if (existing) {
              return {
                id: existing.id,
                providers: new Set((existing.shipping_options || []).map((o: any) => o.provider_id)),
              }
            }
            if (!shippingSet) return null
            changes.push({ entity: "service_zone", id: locationId, field: "zone", before: "none", after: name })
            if (dry_run) return null
            const z = await fulfillmentService.createServiceZones({
              name,
              fulfillment_set_id: shippingSet.id,
              geo_zones: geo,
            })
            const zone = Array.isArray(z) ? z[0] : z
            zonesCreated++
            return { id: zone.id, providers: new Set() }
          }

          const domestic = await ensureZone(domesticZone, `${DOMESTIC_ZONE_NAME} · ${suffix}`, domesticGeoZones)
          const intl = intlGeoZones.length
            ? await ensureZone(intlZone, `${INTL_ZONE_NAME} · ${suffix}`, intlGeoZones)
            : null

          const ensureOption = async (
            zone: { id: string; providers: Set<string> } | null,
            spec: ShippingOptionSpec
          ) => {
            if (!zone) return
            if (zone.providers.has(spec.provider_id)) return
            changes.push({
              entity: "shipping_option",
              id: locationId,
              field: spec.provider_id,
              before: "none",
              after: spec.name,
            })
            if (dry_run) return
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
            optsCreated++
          }

          await ensureOption(domestic, specs.manualLocal)
          if (delhiveryEnabled) await ensureOption(domestic, specs.delhivery)
          await ensureOption(intl, specs.manualIntl)
          if (dhlEnabled) await ensureOption(intl, specs.dhl)
        } catch (err: any) {
          errors.push({ id: `${locationId}`, message: `${tag}: ${err?.message ?? String(err)}` })
        }
      }
    }

    const verb = dry_run ? "Would create" : "Created"
    const carrierNote = `carriers → delhivery:${delhiveryEnabled ? "on" : "off"} dhl:${dhlEnabled ? "on" : "off"}`
    const summary =
      `${verb} ${setsCreated} set(s), ${zonesCreated} zone(s), ${optsCreated} option(s) across partner locations ` +
      `(${skipped} skipped, ${carrierNote}${errors.length ? `, ${errors.length} error(s)` : ""}).`

    return {
      job_id: backfillPartnerShippingOptionsJob.id,
      dry_run,
      applied: !dry_run && (setsCreated > 0 || zonesCreated > 0 || optsCreated > 0),
      summary,
      changes,
      errors,
    }
  },
}

export default backfillPartnerShippingOptionsJob

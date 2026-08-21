import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"
import { z } from "@medusajs/framework/zod"

import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #1417 Data Plumbing — expose Shiprocket on stores that already exist.
 *
 * ## Why a backfill is needed at all
 *
 * Shiprocket was ALREADY fully provisioned on every Indian store: registered as
 * a fulfillment provider in both configs, linked to the stock location by
 * `create-store-with-defaults`, and its pickup location auto-registered. What
 * was never created was a **shipping option** — `providerMap` in that workflow
 * hardcodes `in -> delhivery_delhivery`, so the carrier existed everywhere
 * except the one place a cart can pick it.
 *
 * `create-store-with-defaults` now creates those options, but that only helps
 * stores provisioned from here on. Every store already in production needs this
 * job — otherwise the fix ships and changes nothing for anybody real.
 *
 * ## What it creates, per store
 *
 * · **Domestic zone** — a `calculated` Shiprocket option, so the store gets live
 *   rates exactly the way Delhivery already does.
 * · **Domestic zone** — a `flat` manual companion. 🔑 This is not a nicety: an
 *   IN store's domestic zone carried ONLY calculated options, and
 *   `buildShippingEstimate` skips calculated options when assembling its manual
 *   list — so quote freight rested entirely on one live carrier call with no
 *   fallback, and a hiccup 400'd the whole quote mint.
 * · **International zone** — a `calculated` Shiprocket option, where such a zone
 *   exists. For an Indian origin Shiprocket IS the cross-border rate source:
 *   Delhivery's cross-border product ("Starfleet") has no rate API at all.
 *
 * ## Idempotency
 *
 * Re-runnable. Existing options are matched by `provider_id` within each service
 * zone and skipped, because `createShippingOptions` is perfectly happy to make a
 * second identical option and leave the store with a duplicated carrier in its
 * checkout picker. Dry-run previews every option it would create.
 */

/** Hard cap on stock locations scanned per call — bounds the blast radius. */
export const MAX_SHIPROCKET_OPTION_SCAN = 2000

const SHIPROCKET_PROVIDER_ID = "shiprocket_shiprocket"
const MANUAL_PROVIDER_ID = "manual_manual"

const paramsSchema = z.object({
  /** Restrict to a single stock location (default: every IN location). */
  location_id: z.string().min(1).optional(),
  /** Max stock locations to scan in one call. */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_SHIPROCKET_OPTION_SCAN)
    .optional()
    .default(500),
  /** Flat fallback amount, MAJOR units, for the manual companion option. */
  flat_amount: z.number().nonnegative().optional().default(200),
})

export type ZonePlanKind = "domestic-calculated" | "domestic-flat" | "international-calculated"

export type ZonePlanEntry = {
  zone_id: string
  zone_name: string
  kind: ZonePlanKind
  provider_id: string
}

/**
 * PURE: given one location's fulfillment sets, decide which options are missing.
 *
 * Split out because this is the whole decision — "does this store already have
 * Shiprocket on this zone" — and getting it wrong duplicates a carrier in a live
 * checkout. Testable without a container, a store or a Shiprocket account.
 *
 * A zone counts as INTERNATIONAL when it covers any country other than the
 * store's own. That is derived from the geo zones rather than from the zone's
 * NAME: names are hand-editable and several were renamed by hand during the
 * #954 backfill, so matching on "International" would silently skip them.
 */
export function planShiprocketOptions(args: {
  fulfillmentSets: any[]
  homeCountry: string
}): ZonePlanEntry[] {
  const home = String(args.homeCountry || "").toLowerCase()
  const plan: ZonePlanEntry[] = []

  for (const set of args.fulfillmentSets || []) {
    // Pickup sets never carry a shipping carrier — a Shiprocket option on a
    // pickup zone would offer to courier a parcel the buyer is collecting.
    if (set?.type && set.type !== "shipping") continue

    for (const zone of set?.service_zones || []) {
      if (!zone?.id) continue

      const countries = (zone.geo_zones || [])
        .map((g: any) => String(g?.country_code || "").toLowerCase())
        .filter(Boolean)
      if (!countries.length) continue

      const isInternational = countries.some((c: string) => c !== home)
      const providers = new Set(
        (zone.shipping_options || []).map((o: any) => String(o?.provider_id || ""))
      )

      if (isInternational) {
        if (!providers.has(SHIPROCKET_PROVIDER_ID)) {
          plan.push({
            zone_id: zone.id,
            zone_name: zone.name || zone.id,
            kind: "international-calculated",
            provider_id: SHIPROCKET_PROVIDER_ID,
          })
        }
        continue
      }

      if (!providers.has(SHIPROCKET_PROVIDER_ID)) {
        plan.push({
          zone_id: zone.id,
          zone_name: zone.name || zone.id,
          kind: "domestic-calculated",
          provider_id: SHIPROCKET_PROVIDER_ID,
        })
      }

      // The flat companion is keyed on the absence of ANY flat option in the
      // zone, not on the absence of a manual provider: a store that already has
      // hand-made flat tiers has a fallback, and adding a second one would just
      // put a duplicate row in its checkout.
      const hasFlat = (zone.shipping_options || []).some(
        (o: any) => o?.price_type === "flat"
      )
      if (!hasFlat) {
        plan.push({
          zone_id: zone.id,
          zone_name: zone.name || zone.id,
          kind: "domestic-flat",
          provider_id: MANUAL_PROVIDER_ID,
        })
      }
    }
  }

  return plan
}

export const backfillShiprocketShippingOptionsJob: MaintenanceJob = {
  id: "backfill-shiprocket-shipping-options",
  label: "Backfill Shiprocket shipping options onto existing stores",
  description:
    `Create the missing Shiprocket shipping options on stores that already exist. Shiprocket is already registered as a fulfillment provider and already linked to every Indian stock location, but no shipping option was ever created for it (create-store-with-defaults hardcodes Delhivery), so no cart could pick it. This adds a CALCULATED Shiprocket option to each domestic zone (live rates, exactly as Delhivery does today), a CALCULATED Shiprocket option to each international zone (for an Indian origin, Shiprocket is the cross-border rate source — Delhivery's cross-border product has no rate API), and a FLAT manual companion to any domestic zone that has no flat option at all. That flat option matters: an IN store carrying only calculated options gives buildShippingEstimate no manual fallback, so one failed carrier call 400s the whole quote. Idempotent — options are matched by provider within each zone and skipped if present. Dry-run previews every option it would create. Optionally scope to one location_id. Scans up to 'limit' stock locations per call (default 500, max ${MAX_SHIPROCKET_OPTION_SCAN}).`,
  params: [
    {
      name: "location_id",
      type: "string",
      required: false,
      description: "Restrict to a single stock location (default: every Indian location)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max stock locations to scan in one call (default 500, max ${MAX_SHIPROCKET_OPTION_SCAN})`,
    },
    {
      name: "flat_amount",
      type: "number",
      required: false,
      description:
        "Flat fallback amount in MAJOR units for the manual companion option (default 200)",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { location_id, limit, flat_amount } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const fulfillmentService: any = container.resolve(Modules.FULFILLMENT)

    const graphArgs: Record<string, unknown> = {
      entity: "stock_locations",
      fields: [
        "id",
        "name",
        "address.country_code",
        "fulfillment_sets.id",
        "fulfillment_sets.type",
        "fulfillment_sets.service_zones.id",
        "fulfillment_sets.service_zones.name",
        "fulfillment_sets.service_zones.geo_zones.country_code",
        "fulfillment_sets.service_zones.shipping_options.id",
        "fulfillment_sets.service_zones.shipping_options.provider_id",
        "fulfillment_sets.service_zones.shipping_options.price_type",
      ],
      pagination: { take: limit },
    }
    if (location_id) graphArgs.filters = { id: location_id }
    const { data: locations } = await query.graph(graphArgs as any)

    // A shipping profile is required on every option. Reuse the store's rather
    // than creating one — a second "Default" profile would split the catalogue
    // across two profiles and silently hide products from the new options.
    const profiles = await fulfillmentService.listShippingProfiles({}, { take: 1 })
    const profileId = profiles?.[0]?.id
    if (!profileId) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "No shipping profile exists, so shipping options cannot be created. Seed one first."
      )
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let created = 0
    let locationsAlreadyCurrent = 0
    let locationsSkippedNonIndian = 0

    for (const location of (locations ?? []) as any[]) {
      const homeCountry = String(location?.address?.country_code || "").toLowerCase()

      // Shiprocket is an India-origin carrier. Adding it to a US or EU store's
      // zones would offer a courier that cannot collect the parcel.
      if (homeCountry !== "in") {
        locationsSkippedNonIndian++
        continue
      }

      const plan = planShiprocketOptions({
        fulfillmentSets: location.fulfillment_sets || [],
        homeCountry,
      })

      if (!plan.length) {
        locationsAlreadyCurrent++
        continue
      }

      const suffix = String(location.id).slice(-8)

      for (const entry of plan) {
        changes.push({
          entity: "shipping_option",
          id: entry.zone_id,
          field: entry.kind,
          before: "absent",
          after: `${entry.provider_id} on "${entry.zone_name}"`,
        })

        if (dry_run) {
          created++
          continue
        }

        try {
          const input =
            entry.kind === "domestic-flat"
              ? {
                  name: "Standard Shipping (Flat)",
                  service_zone_id: entry.zone_id,
                  shipping_profile_id: profileId,
                  provider_id: MANUAL_PROVIDER_ID,
                  price_type: "flat",
                  type: {
                    label: "Standard (Flat)",
                    description:
                      "Flat-rate delivery — used when no carrier will quote",
                    code: `flat-fallback-${suffix}`,
                  },
                  prices: [{ currency_code: "inr", amount: flat_amount }],
                  rules: [
                    { attribute: "enabled_in_store", value: "true", operator: "eq" },
                    { attribute: "is_return", value: "false", operator: "eq" },
                  ],
                }
              : {
                  name:
                    entry.kind === "international-calculated"
                      ? "International Shipping (Shiprocket)"
                      : "Standard Shipping (Shiprocket)",
                  service_zone_id: entry.zone_id,
                  shipping_profile_id: profileId,
                  provider_id: SHIPROCKET_PROVIDER_ID,
                  price_type: "calculated",
                  type: {
                    label:
                      entry.kind === "international-calculated"
                        ? "International"
                        : "Standard",
                    description:
                      entry.kind === "international-calculated"
                        ? "Cross-border delivery via Shiprocket — live rates"
                        : "Standard delivery via Shiprocket — live rates",
                    code:
                      entry.kind === "international-calculated"
                        ? `shiprocket-international-${suffix}`
                        : `shiprocket-standard-${suffix}`,
                  },
                  rules: [
                    { attribute: "enabled_in_store", value: "true", operator: "eq" },
                    { attribute: "is_return", value: "false", operator: "eq" },
                  ],
                }

          await createShippingOptionsWorkflow(container).run({ input: [input] as any })
          created++
        } catch (err: any) {
          // One bad zone must not abort the sweep — the rest of the estate
          // still needs its options.
          errors.push({
            id: entry.zone_id,
            message: err?.message ?? String(err),
          })
        }
      }
    }

    const verb = dry_run ? "Would create" : "Created"
    const summary = `${verb} ${created} shipping option(s); ${locationsAlreadyCurrent} location(s) already current, ${locationsSkippedNonIndian} non-Indian location(s) skipped${
      errors.length ? `, ${errors.length} error(s)` : ""
    }.`

    return {
      job_id: backfillShiprocketShippingOptionsJob.id,
      dry_run,
      applied: !dry_run && created > 0,
      summary,
      changes,
      errors,
    }
  },
}

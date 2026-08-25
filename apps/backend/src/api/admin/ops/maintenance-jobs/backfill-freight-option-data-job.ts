import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createShippingOptionsWorkflow,
  updateShippingOptionsWorkflow,
} from "@medusajs/medusa/core-flows"
import { z } from "@medusajs/framework/zod"

import {
  DEFAULT_QUOTE_FREIGHT_TIERS,
  DOMESTIC_FLAT_FALLBACK_AMOUNT,
  buildIntlFallbackByCurrency,
  quoteTierPriceRows,
} from "../../../../lib/freight-default-rates"
import { isQuoteOnlyOption } from "../../../../lib/quote-freight-tiers"

import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #1538 Data Plumbing — stamp the freight `data` that live options never got.
 *
 * ## Why this is the urgent half of #1536
 *
 * #1536 taught the resolver to read a per-CURRENCY fallback off a shipping
 * option's `data`, and taught `create-store-with-defaults` to write it. It did
 * not touch a single row that already exists — and every option in production
 * was created before it, so they all carry no `data` at all.
 *
 * What that means today, with `SHIPROCKET_FLAT_FALLBACK_AMOUNTS` unset in SSM:
 * an international lane the carrier will not quote falls all the way through to
 * `DEFAULT_FLAT_FALLBACK` (200), returned in the CART's currency.
 *
 *   · a EUR cart to the Netherlands is charged **€200**, against an intended €35
 *   · an INR cart abroad is charged **₹200**, against an intended ₹3200
 *
 * 🔴 And this matters MORE after #1536, not less. Now that a live carrier rate
 * wins whenever there is one, the fallback is the only thing standing behind
 * it: it is reached exactly when the carrier has gone quiet, which is precisely
 * when nobody is watching.
 *
 * ## The quote-only tier is not merely unstamped — it does not exist
 *
 * The tiered B2B option (`enabled_in_store: "false"` + `quote_only: "true"`) is
 * provisioned by #1536 for NEW stores only. On an existing store the middle
 * rung of the precedence ladder — live carrier rate → quote-only weight tier →
 * retail flat — is simply absent, so B2B freight still falls to a shopper's
 * postage row. That is the #1417 failure repeating: a carrier registered,
 * linked, and invisible because the one row a picker reads was never created.
 *
 * So this job CREATES that option where an international zone has none. It is
 * the same shape `create-store-with-defaults` writes, from the same table.
 *
 * ## What it will NOT do
 *
 * 🔑 It fills ABSENT keys only. An operator who has edited a store's fallback
 * down to a researched number must not have it silently restored to the
 * placeholder on the next sweep — a backfill that reverts a human edit is worse
 * than one that never ran, because it looks like it worked. Pass
 * `overwrite: true` to restamp deliberately (`#1538` item 2 asks whether €35 is
 * still right; when that is answered, edit `lib/freight-default-rates` and run
 * this with `overwrite`).
 *
 * Only the **Shiprocket** calculated options are stamped. `flat_fallback_amounts`
 * is read by that provider's resolver and by nothing else, so writing it onto a
 * manual or DHL option would be decoration that later reads as configuration.
 *
 * Dry-run previews every before→after. Idempotent: a second run is a no-op.
 */

/** Hard cap on stock locations scanned per call — bounds the blast radius. */
export const MAX_FREIGHT_DATA_SCAN = 2000

const SHIPROCKET_PROVIDER_ID = "shiprocket_shiprocket"
const MANUAL_PROVIDER_ID = "manual_manual"

const paramsSchema = z.object({
  /** Restrict to a single stock location (default: every location). */
  location_id: z.string().min(1).optional(),
  /** Max stock locations to scan in one call. */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_FREIGHT_DATA_SCAN)
    .optional()
    .default(500),
  /**
   * Restamp keys that are already present. Off by default — see the header on
   * why a backfill must not quietly revert an operator's edit.
   */
  overwrite: z.boolean().optional().default(false),
  /**
   * Create the quote-only tiered option in an international zone that has none.
   * On by default: without it the middle rung of the freight ladder stays
   * missing on every existing store, and nothing anywhere fails.
   */
  create_missing_quote_tier: z.boolean().optional().default(true),
})

export type FreightDataPlanKind =
  | "intl-fallback-amounts"
  | "domestic-fallback-amount"
  | "quote-tier-data"
  | "quote-tier-option"

export type FreightDataPlanEntry = {
  zone_id: string
  zone_name: string
  kind: FreightDataPlanKind
  /** Absent for `quote-tier-option`, which has no option to update yet. */
  option_id?: string
  option_name?: string
  before: unknown
  after: unknown
}

/**
 * PURE: given one location's fulfillment sets, decide what freight `data` is
 * missing and where.
 *
 * Split out because this is the whole decision, and it is made against rows
 * that price real consignments. Testable without a container, a store, or a
 * Shiprocket account.
 *
 * A zone counts as INTERNATIONAL when it covers any country other than the
 * store's own — derived from the geo zones rather than the zone's NAME, because
 * names are hand-editable and several were renamed by hand during the #954
 * backfill. Matching on "International" would silently skip them.
 */
export function planFreightOptionData(args: {
  fulfillmentSets: any[]
  homeCountry: string
  /** `data.flat_fallback_amounts` for international calculated options. */
  intlFallbackByCurrency: Record<string, number>
  /** `data.flat_fallback_amount` for domestic calculated options. */
  domesticFallbackAmount: number
  tiers: unknown
  overwrite: boolean
  createMissingQuoteTier: boolean
}): FreightDataPlanEntry[] {
  const home = String(args.homeCountry || "").toLowerCase()
  const plan: FreightDataPlanEntry[] = []

  /**
   * A key counts as present only when it holds something usable. An empty
   * object is what a half-finished edit leaves behind, and treating it as
   * "configured" would leave the lane resolving to 200 forever while this job
   * reported the store as current.
   */
  const isPopulated = (value: unknown): boolean => {
    if (value === null || value === undefined) return false
    if (typeof value === "number") return Number.isFinite(value)
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === "object") return Object.keys(value as object).length > 0
    return false
  }

  for (const set of args.fulfillmentSets || []) {
    // Pickup sets never carry a carrier — freight data on a pickup zone would
    // price a parcel the buyer is collecting in person.
    if (set?.type && set.type !== "shipping") continue

    for (const zone of set?.service_zones || []) {
      if (!zone?.id) continue

      const countries = (zone.geo_zones || [])
        .map((g: any) => String(g?.country_code || "").toLowerCase())
        .filter(Boolean)
      if (!countries.length) continue

      const isInternational = countries.some((c: string) => c !== home)
      const options = (zone.shipping_options || []) as any[]
      const zoneName = zone.name || zone.id

      for (const option of options) {
        if (!option?.id) continue
        const data = (option.data ?? {}) as Record<string, unknown>

        if (isQuoteOnlyOption(option)) {
          const present = isPopulated(data.quote_weight_tiers)
          if (!present || args.overwrite) {
            plan.push({
              zone_id: zone.id,
              zone_name: zoneName,
              kind: "quote-tier-data",
              option_id: option.id,
              option_name: option.name,
              before: present ? data.quote_weight_tiers : "absent",
              after: args.tiers,
            })
          }
          continue
        }

        // Only the carrier whose resolver actually reads these keys.
        if (String(option.provider_id || "") !== SHIPROCKET_PROVIDER_ID) continue
        if (String(option.price_type || "") !== "calculated") continue

        if (isInternational) {
          const present = isPopulated(data.flat_fallback_amounts)
          if (!present || args.overwrite) {
            plan.push({
              zone_id: zone.id,
              zone_name: zoneName,
              kind: "intl-fallback-amounts",
              option_id: option.id,
              option_name: option.name,
              before: present ? data.flat_fallback_amounts : "absent",
              after: args.intlFallbackByCurrency,
            })
          }
          continue
        }

        const present = isPopulated(data.flat_fallback_amount)
        if (!present || args.overwrite) {
          plan.push({
            zone_id: zone.id,
            zone_name: zoneName,
            kind: "domestic-fallback-amount",
            option_id: option.id,
            option_name: option.name,
            before: present ? data.flat_fallback_amount : "absent",
            after: args.domesticFallbackAmount,
          })
        }
      }

      /**
       * The missing middle rung. Keyed on the absence of ANY quote-only option
       * in the zone — not on a name — so a store whose option was created by
       * hand, or renamed, does not get a second one competing with it.
       */
      if (
        isInternational &&
        args.createMissingQuoteTier &&
        !options.some((o: any) => isQuoteOnlyOption(o))
      ) {
        plan.push({
          zone_id: zone.id,
          zone_name: zoneName,
          kind: "quote-tier-option",
          before: "absent",
          after: "Quote Freight — tiered (quote_only)",
        })
      }
    }
  }

  return plan
}

export const backfillFreightOptionDataJob: MaintenanceJob = {
  id: "backfill-freight-option-data",
  label: "Backfill freight fallback data onto live shipping options",
  description:
    `Stamp the freight 'data' that existing shipping options never received (#1538, the tail of #1536). Every option in production was created before the per-currency fallback existed, so an international lane the carrier will not quote falls through to DEFAULT_FLAT_FALLBACK (200) in the CART's currency — €200 on a EUR cart against an intended €35, ₹200 on an INR one against ₹3200. This writes data.flat_fallback_amounts (per currency, from the store's own regions) onto each international CALCULATED Shiprocket option, data.flat_fallback_amount onto each domestic one, and data.quote_weight_tiers onto any quote-only tiered option. Where an international zone has NO quote-only option at all it creates one (enabled_in_store=false + quote_only=true), because otherwise the middle rung of the freight ladder — carrier rate, then quote tier, then retail flat — stays missing on every existing store with nothing failing. Fills ABSENT keys only: an operator's edited amount is never silently restored to the placeholder unless 'overwrite' is passed. Dry-run previews every before→after; re-running is a no-op. Scans up to 'limit' stock locations per call (default 500, max ${MAX_FREIGHT_DATA_SCAN}).`,
  params: [
    {
      name: "location_id",
      type: "string",
      required: false,
      description: "Restrict to a single stock location (default: every location)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max stock locations to scan in one call (default 500, max ${MAX_FREIGHT_DATA_SCAN})`,
    },
    {
      name: "overwrite",
      type: "boolean",
      required: false,
      description:
        "Restamp keys that are already set, overwriting an operator's edited amounts (default false)",
    },
    {
      name: "create_missing_quote_tier",
      type: "boolean",
      required: false,
      description:
        "Create the quote-only tiered option in an international zone that has none (default true)",
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
    const { location_id, limit, overwrite, create_missing_quote_tier } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const fulfillmentService: any = container.resolve(Modules.FULFILLMENT)

    /**
     * The currencies the estate actually sells in. The fallback map is keyed by
     * currency because `calculated_amount` is denominated in the cart's — a map
     * built from countries cannot be right for a store selling in two.
     */
    const { data: regions } = await query.graph({
      entity: "region",
      fields: ["id", "currency_code"],
    })
    const currencies = new Set<string>()
    for (const region of (regions || []) as any[]) {
      const cur = String(region?.currency_code || "").trim().toLowerCase()
      if (cur) currencies.add(cur)
    }
    if (!currencies.size) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "No region carries a currency, so a per-currency fallback cannot be built. " +
          "Seed a region first — stamping a currency-blind number is the bug this fixes."
      )
    }
    const intlFallbackByCurrency = buildIntlFallbackByCurrency(currencies)

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
        "fulfillment_sets.service_zones.shipping_options.name",
        "fulfillment_sets.service_zones.shipping_options.provider_id",
        "fulfillment_sets.service_zones.shipping_options.price_type",
        // ⚠️ `data` and `rules` must be asked for BY NAME. The estimate's
        // `type.code` check was dead from #1485 to #1536 precisely because the
        // query never fetched the field it read — tsc types the shape, not what
        // was requested.
        "fulfillment_sets.service_zones.shipping_options.data",
        "fulfillment_sets.service_zones.shipping_options.rules.attribute",
        "fulfillment_sets.service_zones.shipping_options.rules.value",
      ],
      pagination: { take: limit },
    }
    if (location_id) graphArgs.filters = { id: location_id }
    const { data: locations } = await query.graph(graphArgs as any)

    // Reuse the store's shipping profile rather than creating one — a second
    // "Default" profile splits the catalogue and silently hides products from
    // the new option.
    const profiles = await fulfillmentService.listShippingProfiles({}, { take: 1 })
    const profileId = profiles?.[0]?.id
    if (!profileId && create_missing_quote_tier) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "No shipping profile exists, so a quote-only option cannot be created. Seed one first."
      )
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let stamped = 0
    let createdOptions = 0
    let locationsAlreadyCurrent = 0

    for (const location of (locations ?? []) as any[]) {
      const homeCountry = String(location?.address?.country_code || "").toLowerCase()

      const plan = planFreightOptionData({
        fulfillmentSets: location.fulfillment_sets || [],
        homeCountry,
        intlFallbackByCurrency,
        domesticFallbackAmount: DOMESTIC_FLAT_FALLBACK_AMOUNT,
        tiers: DEFAULT_QUOTE_FREIGHT_TIERS,
        overwrite,
        createMissingQuoteTier: create_missing_quote_tier,
      })

      if (!plan.length) {
        locationsAlreadyCurrent++
        continue
      }

      const suffix = String(location.id).slice(-8)

      for (const entry of plan) {
        changes.push({
          entity: entry.option_id ? "shipping_option" : "service_zone",
          id: entry.option_id ?? entry.zone_id,
          field: `${entry.kind} (${entry.option_name ?? entry.zone_name})`,
          before: entry.before,
          after: entry.after,
        })

        if (dry_run) {
          if (entry.kind === "quote-tier-option") createdOptions++
          else stamped++
          continue
        }

        try {
          if (entry.kind === "quote-tier-option") {
            await createShippingOptionsWorkflow(container).run({
              input: [
                {
                  name: `Quote Freight — tiered (${suffix})`,
                  price_type: "flat",
                  provider_id: MANUAL_PROVIDER_ID,
                  service_zone_id: entry.zone_id,
                  shipping_profile_id: profileId,
                  type: {
                    label: "Quote freight",
                    description:
                      "B2B freight by consignment weight — quotes only, never shown in a cart",
                    code: `quote-freight-tiered-${suffix}`,
                  },
                  // Priced from `data`, not from these rows: Medusa's pricing
                  // context has no `weight`. A price row is still required for
                  // the option to exist, and the LIGHT tier is used so a
                  // misconfiguration fails toward the smaller number.
                  data: { quote_weight_tiers: DEFAULT_QUOTE_FREIGHT_TIERS },
                  prices: quoteTierPriceRows(currencies),
                  rules: [
                    // 🔴 FALSE, deliberately — this must never reach a cart.
                    { attribute: "enabled_in_store", value: "false", operator: "eq" },
                    { attribute: "is_return", value: "false", operator: "eq" },
                    // The POSITIVE marker: it lets the estimate tell
                    // "deliberately not for the shop" from "switched off",
                    // which it must still refuse. Without it the option is
                    // provisioned, priced, and never once used.
                    { attribute: "quote_only", value: "true", operator: "eq" },
                  ],
                },
              ] as any,
            })
            createdOptions++
            continue
          }

          /**
           * MERGE, never replace. `data` is a single JSONB blob shared with
           * whatever else a provider keeps there — DHL's `product_code` lives
           * in the same object — so writing a fresh object would erase
           * configuration this job knows nothing about.
           */
          const key =
            entry.kind === "intl-fallback-amounts"
              ? "flat_fallback_amounts"
              : entry.kind === "domestic-fallback-amount"
                ? "flat_fallback_amount"
                : "quote_weight_tiers"

          const existing = await fulfillmentService.retrieveShippingOption(entry.option_id!)
          const merged = { ...((existing?.data ?? {}) as Record<string, unknown>), [key]: entry.after }

          // The workflow, not the bare service: shipping option prices live in
          // the pricing module behind a remote link the fulfillment service
          // knows nothing about. Only `data` is passed here, so prices and
          // rules are left exactly as they are.
          await updateShippingOptionsWorkflow(container).run({
            input: [{ id: entry.option_id!, data: merged } as any],
          })
          stamped++
        } catch (err: any) {
          // One bad zone must not abort the sweep — every other lane in the
          // estate is still resolving to 200 until it is stamped.
          errors.push({
            id: entry.option_id ?? entry.zone_id,
            message: err?.message ?? String(err),
          })
        }
      }
    }

    const verb = dry_run ? "Would stamp" : "Stamped"
    const createVerb = dry_run ? "would create" : "created"
    const summary =
      `${verb} ${stamped} shipping option(s) and ${createVerb} ${createdOptions} quote-only tiered option(s); ` +
      `${locationsAlreadyCurrent} location(s) already current` +
      (errors.length ? `, ${errors.length} error(s)` : "") +
      `. Currencies: ${[...currencies].sort().join(", ")}.`

    return {
      job_id: backfillFreightOptionDataJob.id,
      dry_run,
      applied: !dry_run && stamped + createdOptions > 0,
      summary,
      changes,
      errors: errors.length ? errors : undefined,
    }
  },
}

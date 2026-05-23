/**
 * Seed canonical regions + tax_regions for the marketplace inheritance model.
 *
 * Background
 * ----------
 * Under the model committed in PR #257, every partner inherits ALL
 * admin-curated regions automatically. That means admin needs to seed
 * the baseline set of regions JYT serves BEFORE partners onboard — a
 * partner store in a country with no admin region would otherwise see
 * no pricing on its storefront for customers in that country.
 *
 * What this script creates (all idempotent — re-runs are safe):
 *   - 8 region rows covering India, US, UK, Eurozone, Australia, Canada,
 *     Singapore, UAE. Each ties its currency, country set, and payment
 *     providers (filtered to whatever's enabled in medusa-config).
 *   - 8 matching tax_region rows with the local default tax rate.
 *     (Province-level overrides — e.g., per-state US tax — are out of
 *     scope; partners customize per-store via the planned
 *     partner_tax_region module.)
 *
 * Idempotency
 * -----------
 *   - Regions are skipped if a region already exists whose country set
 *     overlaps AND currency matches. Prevents duplicate row creation on
 *     re-runs.
 *   - Tax regions are skipped if a tax_region already exists for the
 *     country_code (no province_code).
 *   - Payment providers are filtered to those `is_enabled !== false` in
 *     the live payment_provider table — env-conditional providers
 *     (Stripe, PayU) only get linked where they're actually configured.
 *
 * Usage
 * -----
 *   npx medusa exec src/scripts/seed-canonical-regions.ts
 *
 * Run once after deploy. Re-run safely whenever you add a new currency
 * or country to the canonical set below.
 */
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createRegionsWorkflow,
  createTaxRegionsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

type Continent =
  | "Asia"
  | "Europe"
  | "North America"
  | "South America"
  | "Oceania"
  | "Middle East"
  | "Africa"

type RegionSeed = {
  name: string
  continent: Continent
  currency_code: string
  countries: string[]
  // Provider ids in preference order. The script filters to what's enabled.
  // pp_system_default is always included as a fallback so a region always
  // has at least one provider linked.
  preferred_payment_provider_ids: string[]
  tax: {
    code: string
    name: string
    rate: number // percent, e.g. 18 for 18%
  }
}

// Canonical set, organised by continent for readability and so the
// partner-ui can group regions naturally. Each entry's `metadata.continent`
// is stamped onto the region row by the script — clients can filter / group
// without re-deriving from country codes.
//
// Add entries here when JYT expands to a new market; the next run picks
// them up. The (country_code, currency_code) tuple is the idempotency key:
// re-runs skip rather than duplicate.
const CANONICAL_REGIONS: RegionSeed[] = [
  // ── Asia ────────────────────────────────────────────────────────────
  {
    name: "India",
    continent: "Asia",
    currency_code: "inr",
    countries: ["in"],
    preferred_payment_provider_ids: ["pp_payu_payu", "pp_system_default"],
    tax: { code: "in-gst", name: "India GST", rate: 18 },
  },
  {
    name: "Singapore",
    continent: "Asia",
    currency_code: "sgd",
    countries: ["sg"],
    preferred_payment_provider_ids: ["pp_stripe_stripe", "pp_system_default"],
    tax: { code: "sg-gst", name: "Singapore GST", rate: 9 },
  },
  {
    name: "Japan",
    continent: "Asia",
    currency_code: "jpy",
    countries: ["jp"],
    preferred_payment_provider_ids: ["pp_stripe_stripe", "pp_system_default"],
    tax: { code: "jp-jct", name: "Japan Consumption Tax", rate: 10 },
  },

  // ── Europe ──────────────────────────────────────────────────────────
  {
    name: "Eurozone",
    continent: "Europe",
    currency_code: "eur",
    // Common EUR countries. Admin can extend. (Country-level VAT overrides
    // will land via partner_tax_region or admin-managed tax_region children
    // — the seed picks a single placeholder rate for the parent.)
    countries: ["de", "fr", "it", "es", "nl", "be", "at", "ie", "pt", "fi", "gr"],
    preferred_payment_provider_ids: ["pp_stripe_stripe", "pp_system_default"],
    tax: { code: "eu-vat", name: "EU VAT", rate: 20 },
  },
  {
    name: "United Kingdom",
    continent: "Europe",
    currency_code: "gbp",
    countries: ["gb"],
    preferred_payment_provider_ids: ["pp_stripe_stripe", "pp_system_default"],
    tax: { code: "gb-vat", name: "UK VAT", rate: 20 },
  },

  // ── North America ───────────────────────────────────────────────────
  {
    name: "United States",
    continent: "North America",
    currency_code: "usd",
    countries: ["us"],
    preferred_payment_provider_ids: ["pp_stripe_stripe", "pp_system_default"],
    // Sales tax is state-level. Country-level row has 0 baseline;
    // partners add per-state children when partner_tax_region lands.
    tax: { code: "us-sales-tax", name: "US Sales Tax", rate: 0 },
  },
  {
    name: "Canada",
    continent: "North America",
    currency_code: "cad",
    countries: ["ca"],
    preferred_payment_provider_ids: ["pp_stripe_stripe", "pp_system_default"],
    // 5% federal GST baseline; provincial PST/HST is province-level.
    tax: { code: "ca-gst", name: "Canada GST", rate: 5 },
  },

  // ── Oceania ─────────────────────────────────────────────────────────
  {
    name: "Australia",
    continent: "Oceania",
    currency_code: "aud",
    countries: ["au"],
    preferred_payment_provider_ids: [
      "pp_auspost_auspost",
      "pp_stripe_stripe",
      "pp_system_default",
    ],
    tax: { code: "au-gst", name: "Australia GST", rate: 10 },
  },
  {
    name: "New Zealand",
    continent: "Oceania",
    currency_code: "nzd",
    countries: ["nz"],
    preferred_payment_provider_ids: ["pp_stripe_stripe", "pp_system_default"],
    tax: { code: "nz-gst", name: "New Zealand GST", rate: 15 },
  },

  // ── Middle East ─────────────────────────────────────────────────────
  {
    name: "United Arab Emirates",
    continent: "Middle East",
    currency_code: "aed",
    countries: ["ae"],
    preferred_payment_provider_ids: ["pp_stripe_stripe", "pp_system_default"],
    tax: { code: "ae-vat", name: "UAE VAT", rate: 5 },
  },
]

// Default Medusa tax provider id. medusa-config registers this automatically.
const DEFAULT_TAX_PROVIDER_ID = "tp_system"

export default async function seedCanonicalRegions({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

  logger.info("[seed-canonical-regions] starting…")

  // 1. Enumerate enabled payment providers so we filter the preferred list
  //    to what's actually configured in this env.
  const { data: providerRows } = await query.graph({
    entity: "payment_provider",
    fields: ["id", "is_enabled"],
  })
  const enabledProviderIds = new Set<string>(
    (providerRows || [])
      .filter((p: any) => p.is_enabled !== false)
      .map((p: any) => p.id)
  )
  logger.info(
    `[seed-canonical-regions] enabled payment providers: ${[...enabledProviderIds].join(", ") || "(none)"}`
  )

  // 2. Snapshot existing regions for idempotency. We key by (country, currency)
  //    so re-runs skip rather than duplicate.
  const { data: existingRegions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "countries.iso_2"],
  })
  const existingRegionKey = new Set<string>()
  for (const r of (existingRegions || []) as any[]) {
    for (const c of r.countries || []) {
      existingRegionKey.add(`${String(c.iso_2).toLowerCase()}:${String(r.currency_code).toLowerCase()}`)
    }
  }

  // 3. Snapshot existing tax_regions (country-level, no province) for the
  //    same reason.
  const { data: existingTaxRegions } = await query.graph({
    entity: "tax_regions",
    fields: ["id", "country_code", "province_code"],
  })
  const existingTaxRegionCountries = new Set<string>(
    (existingTaxRegions || [])
      .filter((t: any) => !t.province_code)
      .map((t: any) => String(t.country_code).toLowerCase())
  )

  let regionsCreated = 0
  let regionsSkipped = 0
  let taxRegionsCreated = 0
  let taxRegionsSkipped = 0
  let errors = 0

  for (const seed of CANONICAL_REGIONS) {
    // Skip if any of this seed's countries already has a region with the
    // matching currency. Mixed-currency duplicates aren't our problem to
    // resolve here — admin handles those manually.
    const alreadyExists = seed.countries.some((c) =>
      existingRegionKey.has(`${c.toLowerCase()}:${seed.currency_code.toLowerCase()}`)
    )

    if (alreadyExists) {
      logger.info(
        `[seed-canonical-regions] region ${seed.name} (${seed.currency_code}) already exists — skipping`
      )
      regionsSkipped++
    } else {
      const paymentProviderIds = seed.preferred_payment_provider_ids.filter((id) =>
        enabledProviderIds.has(id)
      )
      if (!paymentProviderIds.length) {
        // Should never happen if pp_system_default is registered, but
        // guard anyway so we don't create a region with zero providers
        // (orders would fail to checkout).
        logger.warn(
          `[seed-canonical-regions] ${seed.name}: no enabled payment providers; skipping`
        )
        errors++
        continue
      }

      try {
        const { result } = await createRegionsWorkflow(container).run({
          input: {
            regions: [
              {
                name: seed.name,
                currency_code: seed.currency_code,
                countries: seed.countries,
                payment_providers: paymentProviderIds,
                // Stamping the continent on the region row lets the
                // partner-ui group regions in a dropdown without
                // re-deriving from country codes. Free-form metadata
                // is fine since clients read it with explicit knowledge
                // of the key.
                metadata: { continent: seed.continent },
              },
            ],
          },
        })
        const region = result?.[0]
        logger.info(
          `[seed-canonical-regions] created region ${seed.name} (${region?.id}) with providers [${paymentProviderIds.join(", ")}]`
        )
        regionsCreated++

        // Update the snapshot so subsequent seeds in this run see the
        // newly-created country mappings (relevant if two seeds share
        // a country, which they shouldn't but defensively).
        for (const c of seed.countries) {
          existingRegionKey.add(`${c.toLowerCase()}:${seed.currency_code.toLowerCase()}`)
        }
      } catch (e: any) {
        logger.error(
          `[seed-canonical-regions] failed to create region ${seed.name}: ${e?.message ?? e}`
        )
        errors++
        continue // don't try to create tax_region for a region that didn't get made
      }
    }

    // 4. Tax region — one per country in this seed. The seed currently puts
    //    one country per region (except Eurozone), so we create a tax_region
    //    per country.
    for (const country of seed.countries) {
      if (existingTaxRegionCountries.has(country.toLowerCase())) {
        logger.info(
          `[seed-canonical-regions] tax_region for ${country.toUpperCase()} already exists — skipping`
        )
        taxRegionsSkipped++
        continue
      }

      try {
        const { result: taxResult } = await createTaxRegionsWorkflow(container).run({
          input: [
            {
              country_code: country,
              provider_id: DEFAULT_TAX_PROVIDER_ID,
              default_tax_rate: {
                code: seed.tax.code,
                name: seed.tax.name,
                rate: seed.tax.rate,
              },
            } as any,
          ],
        })
        logger.info(
          `[seed-canonical-regions] created tax_region for ${country.toUpperCase()} (${(taxResult as any)?.[0]?.id}) at ${seed.tax.rate}%`
        )
        taxRegionsCreated++
        existingTaxRegionCountries.add(country.toLowerCase())
      } catch (e: any) {
        logger.error(
          `[seed-canonical-regions] failed to create tax_region for ${country.toUpperCase()}: ${e?.message ?? e}`
        )
        errors++
      }
    }
  }

  // 5. Backfill existing partner stores' supported_currencies.
  //
  // The store-create workflow already does this for new partners (see
  // finalizeDefaultsStep in create-store-with-defaults.ts). This block
  // handles stores that were created before the inheritance model
  // landed — their supported_currencies only contains the partner's
  // chosen currency, so the partner-ui's pricing grids refuse to render
  // columns for any other region's currency.
  //
  // For each existing store: take the union of its current currencies
  // and ALL admin region currencies. Preserve `is_default` on whatever
  // the partner already had. Skip if nothing changes (idempotent).
  const { data: allRegionCurrencies } = await query.graph({
    entity: "region",
    fields: ["currency_code"],
  })
  const adminCurrencyCodes = new Set<string>(
    (allRegionCurrencies || []).map((r: any) =>
      String(r.currency_code || "").toLowerCase()
    )
  )
  adminCurrencyCodes.delete("")

  const { data: allStores } = await query.graph({
    entity: "store",
    fields: ["id", "name", "supported_currencies.currency_code", "supported_currencies.is_default"],
  })

  let storesUpdated = 0
  let storesSkipped = 0
  for (const store of (allStores || []) as any[]) {
    const current = (store.supported_currencies || []) as Array<{
      currency_code: string
      is_default?: boolean
    }>
    const have = new Set(
      current.map((c) => String(c.currency_code || "").toLowerCase())
    )

    const missing: string[] = []
    for (const cc of adminCurrencyCodes) {
      if (!have.has(cc)) missing.push(cc)
    }
    if (!missing.length) {
      storesSkipped++
      continue
    }

    const next = [
      ...current,
      ...missing.map((currency_code) => ({ currency_code, is_default: false })),
    ]

    try {
      await updateStoresWorkflow(container).run({
        input: {
          selector: { id: store.id },
          update: { supported_currencies: next },
        },
      })
      logger.info(
        `[seed-canonical-regions] expanded supported_currencies on store ${store.id} (${store.name}) +[${missing.join(", ")}]`
      )
      storesUpdated++
    } catch (e: any) {
      logger.error(
        `[seed-canonical-regions] failed to expand currencies on store ${store.id}: ${e?.message ?? e}`
      )
      errors++
    }
  }

  logger.info(
    `[seed-canonical-regions] done. regions: ${regionsCreated} created, ${regionsSkipped} skipped. tax_regions: ${taxRegionsCreated} created, ${taxRegionsSkipped} skipped. stores backfilled: ${storesUpdated} updated, ${storesSkipped} already complete. errors: ${errors}`
  )
}

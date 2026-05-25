import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createTaxRegionsWorkflow } from "@medusajs/medusa/core-flows"

/**
 * Seed canonical tax_regions for every country in every admin-managed
 * region.
 *
 * Why: prod today has tax_regions only for India. Partners selling to
 * customers in Europe / Australia / Indonesia get no tax calculation
 * at checkout — Medusa's TaxModule needs a tax_region per country
 * (with a default_tax_rate) before it can compute anything.
 *
 * This script walks every region in the DB, looks at each region's
 * `countries[]`, and for every country that doesn't yet have a
 * tax_region, creates one. Tax rate is pulled from the
 * COUNTRY_DEFAULT_TAX_RATES table below (curated, statutory rates
 * known as of 2026-05). Countries without a known rate get an empty
 * tax_region (still useful — partners can fill the rate in later via
 * partner UI or admin).
 *
 * Idempotent. Re-runs only create what's missing. Designed to run as
 * a one-shot ECS task at deploy time after the PR-A image lands, but
 * safe to run any time.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-canonical-tax-regions.ts
 *
 * Dry run (logs intent, creates nothing):
 *   npx medusa exec ./src/scripts/seed-canonical-tax-regions.ts --dry-run
 */

// Statutory standard rates as of 2026-05. Conservative — only
// includes countries we have admin regions for plus a few common ones
// we'll likely add. Update as rates change; not a daily concern.
// US deliberately omitted — no federal sales tax, partners with US
// customers handle state-level tax setup themselves via admin or
// their own tax_region rows.
const COUNTRY_DEFAULT_TAX_RATES: Record<
  string,
  { rate: number; code: string; name: string }
> = {
  // South Asia
  in: { rate: 18, code: "IN-GST", name: "India GST (standard)" },

  // Indonesia
  id: { rate: 11, code: "ID-PPN", name: "Indonesia PPN" },

  // Australia / NZ
  au: { rate: 10, code: "AU-GST", name: "Australia GST" },
  nz: { rate: 15, code: "NZ-GST", name: "New Zealand GST" },

  // UK + EU + non-EU European
  gb: { rate: 20, code: "GB-VAT", name: "UK VAT" },
  al: { rate: 20, code: "AL-VAT", name: "Albania VAT" },
  ad: { rate: 4.5, code: "AD-IGI", name: "Andorra IGI" },
  at: { rate: 20, code: "AT-VAT", name: "Austria VAT" },
  be: { rate: 21, code: "BE-VAT", name: "Belgium VAT" },
  bg: { rate: 20, code: "BG-VAT", name: "Bulgaria VAT" },
  hr: { rate: 25, code: "HR-VAT", name: "Croatia VAT" },
  cy: { rate: 19, code: "CY-VAT", name: "Cyprus VAT" },
  cz: { rate: 21, code: "CZ-VAT", name: "Czech Republic VAT" },
  dk: { rate: 25, code: "DK-VAT", name: "Denmark VAT" },
  ee: { rate: 22, code: "EE-VAT", name: "Estonia VAT" },
  fi: { rate: 25.5, code: "FI-VAT", name: "Finland VAT" },
  fr: { rate: 20, code: "FR-VAT", name: "France VAT" },
  de: { rate: 19, code: "DE-VAT", name: "Germany VAT" },
  gr: { rate: 24, code: "GR-VAT", name: "Greece VAT" },
  hu: { rate: 27, code: "HU-VAT", name: "Hungary VAT" },
  ie: { rate: 23, code: "IE-VAT", name: "Ireland VAT" },
  it: { rate: 22, code: "IT-VAT", name: "Italy VAT" },
  lv: { rate: 21, code: "LV-VAT", name: "Latvia VAT" },
  li: { rate: 8.1, code: "LI-MWST", name: "Liechtenstein MWST" },
  lt: { rate: 21, code: "LT-VAT", name: "Lithuania VAT" },
  lu: { rate: 17, code: "LU-VAT", name: "Luxembourg VAT" },
  mt: { rate: 18, code: "MT-VAT", name: "Malta VAT" },
  nl: { rate: 21, code: "NL-VAT", name: "Netherlands VAT" },
  no: { rate: 25, code: "NO-MVA", name: "Norway MVA" },
  pl: { rate: 23, code: "PL-VAT", name: "Poland VAT" },
  pt: { rate: 23, code: "PT-VAT", name: "Portugal VAT" },
  ro: { rate: 19, code: "RO-VAT", name: "Romania VAT" },
  rs: { rate: 20, code: "RS-VAT", name: "Serbia VAT" },
  sk: { rate: 23, code: "SK-VAT", name: "Slovakia VAT" },
  si: { rate: 22, code: "SI-VAT", name: "Slovenia VAT" },
  es: { rate: 21, code: "ES-VAT", name: "Spain VAT" },
  se: { rate: 25, code: "SE-VAT", name: "Sweden VAT" },
  ch: { rate: 8.1, code: "CH-MWST", name: "Switzerland MWST" },

  // Asia commonly added
  sg: { rate: 9, code: "SG-GST", name: "Singapore GST" },
  jp: { rate: 10, code: "JP-JCT", name: "Japan JCT" },
  ae: { rate: 5, code: "AE-VAT", name: "UAE VAT" },

  // Canada (federal GST only — provincial PST/HST varies)
  ca: { rate: 5, code: "CA-GST", name: "Canada GST" },
}

// `provider_id` for root tax_regions. `tp_system` ships with Medusa
// by default. If a partner runs a different tax provider, admin can
// migrate it later; the seed defaults are fine for getting tax
// calculation working at all.
const DEFAULT_TAX_PROVIDER_ID = "tp_system"

export default async function seedCanonicalTaxRegions({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const dryRun = (args ?? []).includes("--dry-run")
  if (dryRun) {
    logger.info("DRY RUN — no tax_regions will be created.")
  }

  // 1. Every admin region's countries.
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "countries.iso_2"],
  })

  if (!regions?.length) {
    logger.info("No regions found. Nothing to seed.")
    return
  }

  const wantedCountryCodes = new Set<string>()
  for (const region of regions as any[]) {
    for (const c of region.countries ?? []) {
      if (c?.iso_2) wantedCountryCodes.add(String(c.iso_2).toLowerCase())
    }
  }

  if (!wantedCountryCodes.size) {
    logger.info("No countries on any region. Nothing to seed.")
    return
  }

  logger.info(
    `Found ${wantedCountryCodes.size} countries across ${regions.length} regions: ${[...wantedCountryCodes].sort().join(", ")}`
  )

  // 2. Existing tax_regions (so we skip what's already there).
  const { data: existingTaxRegions } = await query.graph({
    entity: "tax_regions",
    fields: ["id", "country_code", "parent_id"],
  })

  const existingRootCountries = new Set<string>(
    (existingTaxRegions ?? [])
      .filter((tr: any) => !tr.parent_id) // root tax_regions only
      .map((tr: any) => String(tr.country_code).toLowerCase())
  )

  let created = 0
  let skippedAlreadyExists = 0
  let createdWithoutRate = 0
  const errors: Array<{ country: string; error: string }> = []

  for (const country of [...wantedCountryCodes].sort()) {
    if (existingRootCountries.has(country)) {
      logger.info(`tax_region for ${country.toUpperCase()} already exists — skipping`)
      skippedAlreadyExists++
      continue
    }

    // Skip US — no federal sales tax. Partners with US customers
    // handle state-level tax themselves.
    if (country === "us" || country === "um") {
      logger.info(`Skipping ${country.toUpperCase()} — no federal sales tax`)
      continue
    }

    const knownRate = COUNTRY_DEFAULT_TAX_RATES[country]
    const ratePart = knownRate ? `${knownRate.rate}% (${knownRate.name})` : "no default rate (will need manual fill)"

    if (dryRun) {
      logger.info(`WOULD create tax_region for ${country.toUpperCase()}: ${ratePart}`)
      if (knownRate) created++
      else createdWithoutRate++
      continue
    }

    try {
      const input: any = {
        country_code: country,
        provider_id: DEFAULT_TAX_PROVIDER_ID,
      }
      if (knownRate) {
        input.default_tax_rate = {
          rate: knownRate.rate,
          code: knownRate.code,
          name: knownRate.name,
        }
      }

      await createTaxRegionsWorkflow(container).run({
        input: [input],
      })

      logger.info(`Created tax_region for ${country.toUpperCase()}: ${ratePart}`)
      if (knownRate) created++
      else createdWithoutRate++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`Failed to create tax_region for ${country.toUpperCase()}: ${message}`)
      errors.push({ country, error: message })
    }
  }

  logger.info(
    `Seed complete. created_with_rate=${created}, created_without_rate=${createdWithoutRate}, already_existed=${skippedAlreadyExists}, errors=${errors.length}${
      dryRun ? " (DRY RUN)" : ""
    }`
  )

  if (errors.length) {
    logger.error("Errors during seed — review the log above:")
    for (const e of errors) {
      logger.error(`  country=${e.country}: ${e.error}`)
    }
    process.exitCode = 1
  }
}

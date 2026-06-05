import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export type TaxCoverageGap = {
  partner_id: string
  name: string
  handle: string
  missing: string[]
  covered: string[]
  review_needed: string[]
}

export type TaxCoverageReport = {
  canonical_countries: string[]
  partners_audited: number
  partners_with_gaps: number
  partners_with_reviews: number
  globally_missing: string[]
  per_partner: TaxCoverageGap[]
}

/**
 * Countries whose statutory tax depends on a per-line attribute
 * (price band, customer class, etc.) that Medusa's `tax_rate_rules`
 * cannot express on its own — `rules.reference` only accepts
 * "product" or "product_type". A single canonical default rate is
 * therefore unavoidably wrong for some portion of a partner's
 * catalogue. See `apps/docs/notes/TAX_NOTES.md` for the per-country
 * detail and the partner-side workarounds.
 *
 * Audit treats these as "review needed" rather than "missing": the
 * tax_region exists and a rate flows, but the partner should verify
 * the rate matches the slab their catalogue actually falls into.
 */
const COUNTRIES_REQUIRING_REVIEW: Record<string, string> = {
  in:
    "IN apparel/textile GST is 5% ≤₹2,500/piece, 18% above. Verify whether " +
    "partner's tax_region rate matches their catalogue. See TAX_NOTES.md.",
}

/**
 * Audit script — surface countries that a partner storefront covers
 * but for which no canonical `tax_region` row exists.
 *
 * Why (roadmap item 5): canonical tax_regions are admin-seeded
 * globally (per the `seed-canonical-tax-regions.ts` script PR #261
 * landed). Medusa's cart-tax calculation matches the cart's shipping
 * country against `tax_region.country_code`; if no row exists for that
 * country, the cart shows `tax_total = 0` and the partner under-bills
 * the customer. Region propagation (0B) adds the partner_region link
 * but doesn't touch tax_regions because tax_regions are shared
 * globally — so a brand-new country added to a partner's region
 * silently relies on the canonical seed already having that country.
 *
 * This script is read-only — it reports gaps. The fix path, if gaps
 * exist, is re-running `seed-canonical-tax-regions.ts` (idempotent),
 * which will create the missing rows.
 *
 * Run:
 *   npx medusa exec ./src/scripts/audit-tax-coverage.ts
 *
 * Scope:
 *   --partner-ids=par_a,par_b  (or PARTNER_IDS=…)  — limit to a subset of partners
 */
/**
 * Compute the coverage report without any logging side-effects.
 * Lives separately so integration tests can call it and inspect the
 * shape directly instead of scraping logs.
 */
export async function computeTaxCoverage(
  container: any,
  opts: { partnerIdFilter?: string[] | null } = {}
): Promise<TaxCoverageReport> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const partnerIdFilter = opts.partnerIdFilter?.length
    ? opts.partnerIdFilter
    : null

  // 1. Pull canonical tax_regions once. Root tax_regions (parent_id
  //    null) are the country-level ones the cart-tax lookup matches.
  //    A country counts as "covered" only if it has a tax_region row
  //    AND that row has at least one default tax_rate — otherwise the
  //    cart still resolves to 0% and the partner under-bills. Seed
  //    creates rate-less rows for unknown countries; those are gaps,
  //    not coverage.
  const { data: taxRegions } = await query.graph({
    entity: "tax_regions",
    fields: [
      "id",
      "country_code",
      "parent_id",
      "tax_rates.rate",
      "tax_rates.is_default",
    ],
  })
  const canonicalCountries = new Set<string>(
    (taxRegions ?? [])
      .filter((tr: any) => !tr.parent_id)
      .filter((tr: any) =>
        (tr.tax_rates ?? []).some(
          (r: any) => r?.is_default && Number(r?.rate) > 0
        )
      )
      .map((tr: any) =>
        tr.country_code ? String(tr.country_code).toLowerCase() : ""
      )
      .filter(Boolean)
  )

  // 2. Pull partners (filtered if requested) with their region links +
  //    each region's covered countries. Single query — cheaper than
  //    walking the link table per-partner.
  const { data: partners } = await query.graph({
    entity: "partner",
    filters: partnerIdFilter ? { id: partnerIdFilter } : undefined,
    fields: [
      "id",
      "name",
      "handle",
      "regions.id",
      "regions.name",
      "regions.countries.iso_2",
    ],
    pagination: { skip: 0, take: 1000 },
  })

  // 3. Per-partner coverage. A gap = a country the partner's region
  //    covers but no canonical tax_region exists for. The cart-tax
  //    lookup falls back to zero in that case. A `review_needed`
  //    entry = a country whose statutory tax can't be captured by a
  //    single canonical rate (see COUNTRIES_REQUIRING_REVIEW).
  const perPartner: TaxCoverageGap[] = []
  const globallyMissing = new Set<string>()

  for (const partner of (partners ?? []) as any[]) {
    const missing = new Set<string>()
    const covered = new Set<string>()
    const reviewNeeded = new Set<string>()
    for (const region of partner.regions ?? []) {
      for (const c of region.countries ?? []) {
        const code = c?.iso_2 ? String(c.iso_2).toLowerCase() : ""
        if (!code) continue
        // US (and US Minor Outlying Islands) deliberately have no
        // canonical tax_region — they aren't gaps, they're "partner
        // handles state-level tax themselves". Skip so the report
        // doesn't surface them as actionable misses.
        if (code === "us" || code === "um") continue
        if (canonicalCountries.has(code)) {
          covered.add(code)
        } else {
          missing.add(code)
          globallyMissing.add(code)
        }
        if (COUNTRIES_REQUIRING_REVIEW[code]) {
          reviewNeeded.add(code)
        }
      }
    }
    perPartner.push({
      partner_id: partner.id,
      name: partner.name ?? partner.id,
      handle: partner.handle ?? "",
      missing: [...missing].sort(),
      covered: [...covered].sort(),
      review_needed: [...reviewNeeded].sort(),
    })
  }

  return {
    canonical_countries: [...canonicalCountries].sort(),
    partners_audited: perPartner.length,
    partners_with_gaps: perPartner.filter((p) => p.missing.length).length,
    partners_with_reviews: perPartner.filter((p) => p.review_needed.length).length,
    globally_missing: [...globallyMissing].sort(),
    per_partner: perPartner,
  }
}

export default async function auditTaxCoverage({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const argList = args ?? []
  const parseListArg = (flag: string, envVar: string): string[] | null => {
    const fromArg = argList
      .map((a) => (a.startsWith(`${flag}=`) ? a.slice(flag.length + 1) : null))
      .find((v): v is string => v !== null)
    const raw = fromArg ?? process.env[envVar] ?? ""
    if (!raw.trim()) return null
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  }
  const partnerIdFilter = parseListArg("--partner-ids", "PARTNER_IDS")
  if (partnerIdFilter?.length) {
    logger.info(`Partner scope: ${partnerIdFilter.join(", ")}`)
  }

  const report = await computeTaxCoverage(container, { partnerIdFilter })

  logger.info(
    `Canonical tax_regions exist for ${report.canonical_countries.length} countries: ` +
      `${report.canonical_countries.join(", ") || "(none)"}`
  )

  if (!report.partners_audited) {
    logger.info("No partners found in scope. Nothing to audit.")
    return
  }

  logger.info("")
  logger.info("─── Per-partner coverage ───")
  for (const p of report.per_partner) {
    const tag = `${p.name} (${p.handle || "(no handle)"}) [${p.partner_id}]`
    if (p.missing.length) {
      logger.warn(
        `✗ ${tag}: MISSING ${p.missing.join(", ").toUpperCase()} ` +
          `(covered: ${p.covered.join(", ").toUpperCase() || "—"})`
      )
    } else {
      logger.info(`✓ ${tag}: all ${p.covered.length} covered countries have tax_regions`)
    }
    // Review flags are independent of missing-ness — a partner can be
    // fully covered AND still need to review whether their canonical
    // rate matches their catalogue (e.g. IN price-band split).
    for (const country of p.review_needed) {
      logger.warn(
        `  ⚠ REVIEW ${country.toUpperCase()}: ${COUNTRIES_REQUIRING_REVIEW[country]}`
      )
    }
  }

  logger.info("")
  logger.info("─── Summary ───")
  logger.info(`partners_audited      = ${report.partners_audited}`)
  logger.info(`partners_with_gaps    = ${report.partners_with_gaps}`)
  logger.info(`partners_with_reviews = ${report.partners_with_reviews}`)
  logger.info(
    `globally_missing      = ${report.globally_missing.length}` +
      (report.globally_missing.length
        ? ` (${report.globally_missing.join(", ").toUpperCase()})`
        : "")
  )

  if (report.globally_missing.length) {
    logger.info("")
    logger.info(
      "Fix: re-run seed-canonical-tax-regions.ts — idempotent, " +
        "creates the missing rows from the curated rate table."
    )
  } else if (report.partners_with_reviews) {
    logger.info("")
    logger.info(
      `✓ No gaps. ${report.partners_with_reviews} partner(s) flagged for review ` +
        `— see apps/docs/notes/TAX_NOTES.md for context.`
    )
  } else {
    logger.info("✓ No gaps, no reviews needed. Every partner-covered country has a canonical tax_region with a matching rate.")
  }
}

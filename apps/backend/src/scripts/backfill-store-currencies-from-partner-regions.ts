import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateStoresWorkflow } from "@medusajs/medusa/core-flows"
import partnerRegionLink from "../links/partner-region"

/**
 * Backfill `store.supported_currencies` so it covers every currency
 * used by a region linked to the partner that owns the store.
 *
 * Why: partner-ui's product pricing grid disables the currency column
 * for any region whose currency_code isn't in store.supported_currencies.
 * Partners who created regions BEFORE the auto-expand code landed in
 * commit 7e94fd5f7 still have stores missing those currencies and see
 * disabled columns. This script reconciles in one pass.
 *
 * Companion to backfill-partner-region-links — both are pre-cutover
 * one-shots for the PR feat/partner-regions-admin-parity deploy.
 *
 * Idempotent — re-runs add only currencies that aren't already
 * supported, and never touch the `is_default` flag on existing
 * currencies.
 *
 * Run:
 *   npx medusa exec ./src/scripts/backfill-store-currencies-from-partner-regions.ts
 *
 * Dry run — logs what would happen, mutates nothing. Two equivalent ways:
 *   - Args:    npx medusa exec ./src/scripts/backfill-store-currencies-from-partner-regions.ts -- --dry-run
 *   - Env var: DRY_RUN=1 npx medusa exec ./src/scripts/backfill-store-currencies-from-partner-regions.ts
 *
 * deploy/aws/scripts/run-backfill.sh uses the env-var form when spawning
 * one-shot ECS tasks.
 */
export default async function backfillStoreCurrencies({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const dryRun =
    (args ?? []).includes("--dry-run") || process.env.DRY_RUN === "1"
  if (dryRun) {
    logger.info("DRY RUN — no stores will be updated.")
  }

  // 1. Every partner with their stores' supported_currencies.
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: [
      "id",
      "name",
      "stores.id",
      "stores.name",
      "stores.supported_currencies.currency_code",
      "stores.supported_currencies.is_default",
    ],
  })

  if (!partners?.length) {
    logger.info("No partners found. Nothing to backfill.")
    return
  }

  // 2. Every partner_region link, then fetch the linked regions
  //    separately. Tried `region.currency_code` as a field expansion on
  //    the link but it came back undefined — the link table exposes
  //    region_id as a scalar, not the region relation by default for
  //    graph queries against the link entryPoint. Two-step query is
  //    explicit and reliable.
  const { data: links } = await query.graph({
    entity: partnerRegionLink.entryPoint,
    fields: ["partner_id", "region_id"],
  })

  const allRegionIds = Array.from(
    new Set((links ?? []).map((l: any) => l.region_id).filter(Boolean))
  )

  const regionCurrencyById = new Map<string, string>()
  if (allRegionIds.length) {
    const { data: regions } = await query.graph({
      entity: "region",
      filters: { id: allRegionIds },
      fields: ["id", "currency_code"],
    })
    for (const region of (regions ?? []) as any[]) {
      if (region?.id && region?.currency_code) {
        regionCurrencyById.set(region.id, String(region.currency_code).toLowerCase())
      }
    }
  }


  // Index: partner_id -> Set of currency codes the partner needs.
  const partnerCurrencies = new Map<string, Set<string>>()
  for (const link of (links ?? []) as any[]) {
    const partnerId = link.partner_id
    const currency = regionCurrencyById.get(link.region_id)
    if (!partnerId || !currency) continue
    if (!partnerCurrencies.has(partnerId)) {
      partnerCurrencies.set(partnerId, new Set())
    }
    partnerCurrencies.get(partnerId)!.add(currency)
  }

  let storesUpdated = 0
  let storesAlreadyCurrent = 0
  let storesWithoutRegions = 0
  const errors: Array<{ partner: string; store: string; error: string }> = []

  for (const partner of partners as any[]) {
    const wanted = partnerCurrencies.get(partner.id)
    const stores = partner.stores ?? []

    if (!stores.length) continue

    if (!wanted || wanted.size === 0) {
      // Partner has stores but no linked regions — nothing to add.
      // Counted separately so the operator sees that this partner
      // exists but has no region scope yet.
      for (const _ of stores) storesWithoutRegions++
      continue
    }

    for (const store of stores) {
      const existing = (store.supported_currencies ?? []) as Array<{
        currency_code: string
        is_default?: boolean
      }>
      const existingCodes = new Set(
        existing.map((c) => String(c.currency_code).toLowerCase())
      )
      const missing: string[] = []
      for (const code of wanted) {
        if (!existingCodes.has(code)) missing.push(code)
      }

      const tag = `partner "${partner.name}" (${partner.id}), store "${store.name}" (${store.id})`

      if (!missing.length) {
        logger.info(`${tag}: already covers all linked region currencies — skipping`)
        storesAlreadyCurrent++
        continue
      }

      if (dryRun) {
        logger.info(
          `${tag}: WOULD add currencies [${missing.join(", ")}] to supported_currencies`
        )
        storesUpdated++
        continue
      }

      const next = [
        // Preserve existing entries verbatim — never touch is_default flags
        // already on the store.
        ...existing.map((c) => ({
          currency_code: c.currency_code,
          is_default: !!c.is_default,
        })),
        ...missing.map((code) => ({ currency_code: code, is_default: false })),
      ]

      try {
        // updateStoresWorkflow is the only path that correctly handles
        // supported_currencies updates — the direct storeService call
        // silently returns [] for that field (other fields like
        // default_region_id appear to work, but supported_currencies is
        // a managed relation that needs the workflow's link plumbing).
        // Matches the pattern in src/scripts/seed.ts.
        await updateStoresWorkflow(container).run({
          input: {
            selector: { id: store.id },
            update: { supported_currencies: next },
          },
        })
        logger.info(
          `${tag}: added currencies [${missing.join(", ")}] to supported_currencies`
        )
        storesUpdated++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error(`${tag}: failed to update store — ${message}`)
        errors.push({ partner: partner.id, store: store.id, error: message })
      }
    }
  }

  logger.info(
    `Backfill complete. stores_updated=${storesUpdated}, stores_already_current=${storesAlreadyCurrent}, stores_without_linked_regions=${storesWithoutRegions}, errors=${errors.length}${
      dryRun ? " (DRY RUN)" : ""
    }`
  )

  if (errors.length) {
    logger.error("Errors during backfill — review the log above:")
    for (const e of errors) {
      logger.error(`  partner=${e.partner} store=${e.store}: ${e.error}`)
    }
    process.exitCode = 1
  }
}

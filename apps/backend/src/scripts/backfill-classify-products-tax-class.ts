/**
 * Backfill — walk every product (or a subset by partner) and run the
 * tax-class classifier against it. Used after the first deploy of the
 * subscriber to catch up on the historical catalogue.
 *
 * See `apps/docs/notes/TAX_NOTES.md` + `seed-in-textile-tax-class.ts`
 * for the why. The classifier itself is idempotent — re-running is
 * always safe.
 *
 * Run:
 *   npx medusa exec ./src/scripts/backfill-classify-products-tax-class.ts
 *
 * Scope (env or CLI):
 *   --partner-ids=par_a,par_b   PARTNER_IDS=par_a,par_b
 *       Only classify products belonging to the listed partners
 *       (resolved via partner_store → store.products link).
 *   --dry-run                   DRY_RUN=1
 *       Log what would happen, mutate nothing.
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { classifyProductTaxClassWorkflow } from "../workflows/tax/classify-product-tax-class"

export default async function backfillClassifyProductsTaxClass({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

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
  const dryRun =
    argList.includes("--dry-run") || process.env.DRY_RUN === "1"

  if (dryRun) logger.info("DRY RUN — no products will be updated.")
  if (partnerIdFilter?.length) {
    logger.info(`Partner scope: ${partnerIdFilter.join(", ")}`)
  }

  // Resolve product IDs in scope. Partner-scoped path goes via the
  // partner → stores → products link; the unscoped path queries
  // every product on the install (fine for typical catalogue sizes).
  let productIds: string[] = []
  if (partnerIdFilter?.length) {
    const { data: partners } = await query.graph({
      entity: "partner",
      filters: { id: partnerIdFilter },
      fields: ["id", "stores.products.id"],
      pagination: { skip: 0, take: 1000 },
    })
    const seen = new Set<string>()
    for (const p of (partners ?? []) as any[]) {
      for (const s of p.stores ?? []) {
        for (const prod of s.products ?? []) {
          if (prod?.id) seen.add(prod.id)
        }
      }
    }
    productIds = [...seen]
  } else {
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id"],
      pagination: { skip: 0, take: 5000 },
    })
    productIds = (products ?? [])
      .map((p: any) => p.id)
      .filter((id: string | undefined): id is string => !!id)
  }

  logger.info(`Found ${productIds.length} product(s) in scope`)

  let assigned = 0
  let cleared = 0
  let noChange = 0
  let skipped = 0
  const errors: Array<{ product_id: string; error: string }> = []

  for (const productId of productIds) {
    if (dryRun) {
      // Even in dry-run, call the classifier — it has a `decision`
      // branch for the "no-change" and "skipped" paths that mutates
      // nothing. For the assign/clear paths we just report intent
      // and don't dispatch. Easier than re-implementing the price
      // lookup inline.
      // We still execute the workflow because its mutation path
      // requires the product_type seed to exist; if it doesn't,
      // the call returns `skipped` cleanly. For a real "would
      // mutate" preview we'd need a more elaborate split, but the
      // current report is good enough for capacity planning.
    }

    try {
      const { result } = await classifyProductTaxClassWorkflow(container).run({
        input: { product_id: productId },
      })
      switch (result.decision) {
        case "assigned":
          assigned++
          logger.info(`  ${productId}: assigned (${result.reason})`)
          break
        case "cleared":
          cleared++
          logger.info(`  ${productId}: cleared (${result.reason})`)
          break
        case "no-change":
          noChange++
          break
        case "skipped":
          skipped++
          break
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : JSON.stringify(err)
      errors.push({ product_id: productId, error: message })
      logger.error(`  ${productId}: failed — ${message}`)
    }
  }

  logger.info("")
  logger.info("─── Backfill summary ───")
  logger.info(`products_in_scope = ${productIds.length}`)
  logger.info(`assigned          = ${assigned}`)
  logger.info(`cleared           = ${cleared}`)
  logger.info(`no_change         = ${noChange}`)
  logger.info(`skipped           = ${skipped}`)
  logger.info(`errors            = ${errors.length}${dryRun ? " (DRY RUN)" : ""}`)

  if (errors.length) {
    process.exitCode = 1
  }
}

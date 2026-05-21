/**
 * Backfill the product_search_v1 PgVector index with every published
 * product. Idempotent — products whose source text hasn't changed
 * since the last embedding are skipped via text_hash compare in
 * upsertProducts.
 *
 * Run with:
 *   pnpm --filter @jyt/backend exec medusa exec ./src/scripts/backfill-product-search.ts
 *
 * Or set BATCH=100 / DRY_RUN=1 in the environment to tune.
 */
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { upsertProducts } from "../mastra/rag/productCatalog"

const PRODUCT_FIELDS = [
  "id",
  "handle",
  "title",
  "subtitle",
  "description",
  "material",
  "thumbnail",
  "status",
  "tags.value",
  "categories.name",
  "collection.title",
  "type.value",
]

export default async function backfillProductSearch({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const BATCH = Number(process.env.BATCH || 50)
  const DRY_RUN = process.env.DRY_RUN === "1"

  logger.info(
    `[product-search backfill] starting (batch=${BATCH}${DRY_RUN ? " DRY_RUN" : ""})`
  )

  let offset = 0
  let totals = { fetched: 0, upserted: 0, skipped: 0, errors: 0 }
  for (;;) {
    const { data } = await query.graph({
      entity: "product",
      fields: PRODUCT_FIELDS,
      filters: { status: "published" } as any,
      pagination: { take: BATCH, skip: offset },
    })
    const batch = data ?? []
    if (!batch.length) break

    totals.fetched += batch.length
    logger.info(
      `[product-search backfill] batch ${offset / BATCH + 1}: ${batch.length} products (offset=${offset})`
    )

    if (!DRY_RUN) {
      const result = await upsertProducts(batch as any, container)
      totals.upserted += result.upserted
      totals.skipped += result.skipped
      totals.errors += result.errors
      logger.info(
        `[product-search backfill] batch result: upserted=${result.upserted} skipped=${result.skipped} errors=${result.errors}`
      )
    }

    if (batch.length < BATCH) break
    offset += BATCH
  }

  logger.info(
    `[product-search backfill] done. ` +
      `fetched=${totals.fetched} upserted=${totals.upserted} ` +
      `skipped=${totals.skipped} errors=${totals.errors}`
  )
}

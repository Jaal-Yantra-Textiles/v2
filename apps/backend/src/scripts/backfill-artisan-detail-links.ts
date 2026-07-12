import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ExecArgs } from "@medusajs/framework/types"
import { ARTISAN_PRODUCT_DETAIL_MODULE } from "../modules/artisan-product-detail"

/**
 * One-off: create missing product ↔ artisan_product_detail links (#859).
 *
 * The upsert workflow originally created the link only on the first-create
 * branch, so any detail row whose link never persisted (e.g. link-migration lag
 * when the row was first written) stayed unlinked forever: readable by the
 * module via its `product_id` column, but invisible to `query.graph`. The
 * storefront preview/PDP resolve the maker story through the link, so it
 * silently dropped. The workflow now ensures the link on every upsert; this
 * script catches up existing rows.
 *
 * Idempotent — products already linked (verified via the same query.graph the
 * storefront uses) are skipped.
 *
 * Usage:
 *   DRY_RUN=1 npx medusa exec ./src/scripts/backfill-artisan-detail-links.ts
 *   npx medusa exec ./src/scripts/backfill-artisan-detail-links.ts
 */
export default async function backfillArtisanDetailLinks({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK) as any

  const dryRun = process.env.DRY_RUN === "1"

  const service: any = container.resolve(ARTISAN_PRODUCT_DETAIL_MODULE)
  const details: any[] = await service.listArtisanProductDetails(
    {},
    { take: null }
  )

  logger.info(
    `[backfill-artisan-detail-links] ${details?.length || 0} artisan detail row(s) to inspect${dryRun ? " (dry run)" : ""}`
  )

  let linked = 0
  let already = 0
  let orphaned = 0
  let errors = 0

  for (const d of details || []) {
    const productId = d.product_id
    if (!productId) {
      orphaned++
      logger.warn(
        `[backfill-artisan-detail-links] detail ${d.id} has no product_id — skipped`
      )
      continue
    }
    try {
      // Check the relation exactly as the storefront does — through the link,
      // not the column — so we only create links that are genuinely missing.
      const { data: products = [] } = await query.graph({
        entity: "product",
        // Product-side alias is the linked model's name (#859).
        fields: ["id", "artisan_product_detail.id"],
        filters: { id: productId },
      })
      const product = products[0] as any
      if (!product) {
        orphaned++
        logger.warn(
          `[backfill-artisan-detail-links] detail ${d.id} → product ${productId} not found — skipped`
        )
        continue
      }
      if (product.artisan_product_detail?.id) {
        already++
        continue
      }
      if (dryRun) {
        linked++
        logger.info(
          `[backfill-artisan-detail-links] would link product ${productId} → detail ${d.id}`
        )
        continue
      }
      await link.create({
        [Modules.PRODUCT]: { product_id: productId },
        [ARTISAN_PRODUCT_DETAIL_MODULE]: { artisan_product_detail_id: d.id },
      })
      linked++
      logger.info(
        `[backfill-artisan-detail-links] linked product ${productId} → detail ${d.id}`
      )
    } catch (e: any) {
      errors++
      logger.error(
        `[backfill-artisan-detail-links] detail ${d.id} (product ${productId}): ${e?.message}`
      )
    }
  }

  logger.info(
    `[backfill-artisan-detail-links] done — ${dryRun ? "would link" : "linked"}=${linked} already=${already} orphaned=${orphaned} errors=${errors}`
  )
}

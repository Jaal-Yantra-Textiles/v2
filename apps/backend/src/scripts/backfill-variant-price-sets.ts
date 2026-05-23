/**
 * Backfill empty price_sets for product variants missing a variant ↔ price_set link.
 *
 * Background
 * ----------
 * The partner variant POST routes (single create + single update) used to
 * call the bare product service instead of `createProductVariantsWorkflow`
 * / `updateProductVariantsWorkflow`. The bare service creates a variant
 * but does NOT create the variant ↔ price_set remote link, so any variant
 * created via that path has `variant.price_set` === null.
 *
 * Medusa's admin /products/:id/prices page reads `variant.prices` (joined
 * through the price_set link). For unlinked variants the field comes back
 * undefined and the page crashes on `variant.prices.reduce(...)`. Newly
 * created variants are fine after the route fix; this script repairs the
 * historical ones.
 *
 * Usage
 * -----
 *   npx medusa exec src/scripts/backfill-variant-price-sets.ts
 *
 * The script is idempotent — variants that already have a price_set
 * link are skipped, so it's safe to re-run.
 */
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function backfillVariantPriceSets({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
  const pricingModule = container.resolve(Modules.PRICING)

  logger.info("[backfill-variant-price-sets] Scanning for variants missing a price_set link…")

  const { data: variants } = await query.graph({
    entity: "product_variants",
    fields: ["id", "product_id", "title", "sku", "price_set.id"],
  })

  if (!variants?.length) {
    logger.info("[backfill-variant-price-sets] No variants found. Nothing to do.")
    return
  }

  // Find the orphans — variants where the joined price_set is null/missing.
  // The remote-query expansion returns price_set as null (not undefined) when
  // there is no link record; treat any falsy id as "missing".
  const orphans = variants.filter(
    (v: any) => !v?.price_set?.id
  ) as Array<{ id: string; product_id: string; title?: string; sku?: string }>

  logger.info(
    `[backfill-variant-price-sets] Found ${variants.length} variant(s), ${orphans.length} missing a price_set link.`
  )

  if (orphans.length === 0) {
    return
  }

  // Batch the work: one createPriceSets call for all orphans, then one
  // remoteLink.create for all links. Order of returned price_sets matches
  // input order, which lets us pair them up with the orphan list by index.
  const priceSetInputs = orphans.map(() => ({ prices: [] }))

  let createdPriceSets: Array<{ id: string }> = []
  try {
    // pricingModule.createPriceSets has overloads: passing an array returns
    // PriceSetDTO[], passing a single object returns PriceSetDTO. The type
    // narrows on the literal shape — cast through unknown to satisfy TS.
    createdPriceSets = (await pricingModule.createPriceSets(
      priceSetInputs as any
    )) as unknown as Array<{ id: string }>
  } catch (err) {
    logger.error(
      `[backfill-variant-price-sets] Failed to create price_sets: ${err}`
    )
    throw err
  }

  if (createdPriceSets.length !== orphans.length) {
    logger.error(
      `[backfill-variant-price-sets] price_set count mismatch (got ${createdPriceSets.length}, expected ${orphans.length}). Aborting before linking to avoid orphaned price_sets.`
    )
    return
  }

  const links = orphans.map((variant, i) => ({
    [Modules.PRODUCT]: { variant_id: variant.id },
    [Modules.PRICING]: { price_set_id: createdPriceSets[i].id },
  }))

  try {
    await remoteLink.create(links)
  } catch (err) {
    logger.error(
      `[backfill-variant-price-sets] Failed to create variant↔price_set links: ${err}`
    )
    throw err
  }

  for (let i = 0; i < orphans.length; i++) {
    const v = orphans[i]
    logger.info(
      `[backfill-variant-price-sets] linked variant ${v.id} (sku=${v.sku ?? "—"}) → price_set ${createdPriceSets[i].id}`
    )
  }

  logger.info(
    `[backfill-variant-price-sets] Done. Backfilled ${orphans.length} variant(s).`
  )
}

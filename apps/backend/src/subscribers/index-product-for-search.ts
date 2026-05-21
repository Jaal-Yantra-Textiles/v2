/**
 * Indexes products into the product_search_v1 PgVector index whenever
 * they're created or updated, and removes them on delete. Powers
 * /store/ai/search.
 *
 * Idempotent: upsertProducts skips products whose source text hash is
 * unchanged since the last embedding, so re-firing a product.updated
 * event for an unrelated metadata change costs almost nothing.
 *
 * Errors are logged but never propagate — search-index maintenance
 * should not block product saves or fail the originating workflow.
 */
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
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

const indexOne = async (
  container: any,
  productId: string
): Promise<void> => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve("logger")

  try {
    const { data } = await query.graph({
      entity: "product",
      fields: PRODUCT_FIELDS,
      filters: { id: productId } as any,
    })
    const product = (data ?? [])[0]
    if (!product) {
      logger?.debug?.(
        `[product-search] product ${productId} not found for re-index — likely deleted`
      )
      return
    }
    // Only index published products. Drafts shouldn't be discoverable
    // via storefront search.
    if (product.status !== "published") {
      logger?.debug?.(
        `[product-search] product ${productId} not published (status=${product.status}); skipping index`
      )
      return
    }
    const result = await upsertProducts([product as any])
    logger?.debug?.(
      `[product-search] indexed product ${productId}: ` +
        `upserted=${result.upserted} skipped=${result.skipped} errors=${result.errors}`
    )
  } catch (e: any) {
    logger?.warn?.(
      `[product-search] failed to index product ${productId}: ${e?.message ?? e}`
    )
  }
}

export default async function indexProductForSearchHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const id = event?.data?.id
  if (!id) return
  // Fire and forget — never block the originating workflow on indexing.
  void indexOne(container, id)
}

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated"],
}

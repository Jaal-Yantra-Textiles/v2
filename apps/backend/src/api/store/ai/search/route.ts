/**
 * POST /store/ai/search
 *
 * Natural-language product search. Two-stage pipeline:
 *
 *   1. LLM extracts a small structured interpretation from the query
 *      (keywords + optional color/material/price range).
 *   2. We run a semantic vector search against the product_search_v1
 *      PgVector index using the enriched query text, then post-filter by
 *      the structured constraints (price) that aren't part of the
 *      embedding signal.
 *   3. Finally we hydrate the hits back through Medusa's product query
 *      so the caller gets a payload shaped like /store/products
 *      (id, handle, title, thumbnail, variants[].calculated_price).
 *
 * Public (no customer auth). Rate limiting + caching are TODOs.
 *
 * If the vector index is empty (no backfill yet) or PgVector is
 * unreachable, the route falls back to a plain Medusa q-search using
 * the LLM-extracted keywords so the storefront keeps working while the
 * index is being built.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { searchProducts } from "../../../../mastra/rag/productCatalog"
import { extractSearchInterpretation } from "./extract"
import type { StoreAiSearchReq } from "./validators"

const PRODUCT_FIELDS = [
  "id",
  "handle",
  "title",
  "subtitle",
  "description",
  "thumbnail",
  "status",
  "variants.id",
  "variants.title",
  "variants.calculated_price.calculated_amount",
  "variants.calculated_price.currency_code",
]

const buildEnrichedQuery = (
  raw: string,
  interpretation: Awaited<ReturnType<typeof extractSearchInterpretation>>
): string => {
  // Concatenate the structured fields onto the raw query so the
  // embedding has both phrasing AND distilled keywords to anchor on.
  const extras: string[] = []
  if (interpretation.color) extras.push(interpretation.color)
  if (interpretation.material) extras.push(interpretation.material)
  for (const k of interpretation.keywords) {
    if (!extras.some((x) => x.toLowerCase() === k.toLowerCase())) {
      extras.push(k)
    }
  }
  return extras.length ? `${raw}. Keywords: ${extras.join(", ")}` : raw
}

const applyPriceFilter = (
  product: any,
  min?: number,
  max?: number
): boolean => {
  if (min === undefined && max === undefined) return true
  const amounts = ((product?.variants ?? []) as any[])
    .map((v) => v?.calculated_price?.calculated_amount)
    .filter((n): n is number => typeof n === "number")
  if (!amounts.length) return true
  const low = Math.min(...amounts)
  const high = Math.max(...amounts)
  if (max !== undefined && low > max) return false
  if (min !== undefined && high < min) return false
  return true
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { query, limit } = (req as any).validatedBody as StoreAiSearchReq
  const queryService = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // 1. Interpret the query.
  const interpretation = await extractSearchInterpretation(query)

  // 2. Try vector search first.
  const enriched = buildEnrichedQuery(query, interpretation)
  let productIds: string[] = []
  let mode: "vector" | "lexical" = "vector"
  try {
    const hits = await searchProducts(enriched, Math.max(limit * 3, 24))
    productIds = hits.map((h) => h.product_id).filter(Boolean)
  } catch {
    productIds = []
  }

  let products: any[] = []
  if (productIds.length) {
    const { data } = await queryService.graph({
      entity: "product",
      fields: PRODUCT_FIELDS,
      filters: { id: productIds, status: "published" } as any,
    })
    // Preserve vector-search rank — graph results don't guarantee
    // ordering by the id list.
    const byId = new Map((data ?? []).map((p: any) => [p.id, p]))
    products = productIds.map((id) => byId.get(id)).filter(Boolean)
  }

  // 3. Lexical fallback if vector search returned nothing (e.g. index
  // not backfilled yet, or query truly has no matches).
  if (!products.length) {
    mode = "lexical"
    const terms: string[] = []
    if (interpretation.color) terms.push(interpretation.color)
    if (interpretation.material) terms.push(interpretation.material)
    for (const k of interpretation.keywords) {
      if (!terms.includes(k.toLowerCase())) terms.push(k)
    }
    const q = terms.join(" ") || query
    const { data } = await queryService.graph({
      entity: "product",
      fields: PRODUCT_FIELDS,
      filters: { status: "published", q } as any,
      pagination: { take: Math.max(limit * 3, 24), skip: 0 },
    })
    products = data ?? []
  }

  // 4. Apply price post-filter and cap at the requested limit.
  const filtered = products
    .filter((p) =>
      applyPriceFilter(p, interpretation.min_price, interpretation.max_price)
    )
    .slice(0, limit)

  res.json({
    query,
    mode,
    interpretation,
    products: filtered,
    count: filtered.length,
  })
}

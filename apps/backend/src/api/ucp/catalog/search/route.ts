import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import qs from "qs"
import {
  buildUcpContext,
  resolveCatalogPriceContext,
  resolveCategoryIds,
} from "../../lib/context"
import { formatUcpProduct, catalogEnvelope, UCP_VERSION } from "../../lib/formatter"
import { formatUcpError } from "../../lib/error-formatter"

/**
 * Fields selector. Base prices (`*variants.prices`) never need a pricing context,
 * so they're always safe. `calculated_price` REQUIRES a region/country — request
 * it only when we have one, otherwise Medusa errors the whole call.
 */
function productFields(hasRegion: boolean): string {
  return hasRegion
    ? "*variants.calculated_price,*variants.prices"
    : "*variants.prices"
}

/**
 * POST /ucp/catalog/search
 *
 * Search the storefront catalog. Full-text query + spec filters (categories,
 * price) and buyer context (country/currency) for localized pricing.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const ctx = await buildUcpContext(req)
  const body = req.validatedBody as any
  const messages: { type: string; code: string; content: string }[] = []

  try {
    const query: Record<string, unknown> = {}
    if (body.query) query.q = body.query
    if (body.filters?.collection) query.collection_id = body.filters.collection

    // Categories: spec `categories` (values/ids) or legacy `category`.
    const catValues: string[] = body.filters?.categories
      ? body.filters.categories
      : body.filters?.category
        ? [body.filters.category]
        : []
    if (catValues.length) {
      const ids = await resolveCategoryIds(ctx.container, catValues)
      if (ids.length) query.category_id = ids
    }

    query.limit = body.pagination?.limit ?? 20
    query.offset = body.pagination?.offset ?? 0

    // Pricing context → Medusa region/country params + presentment currency.
    const priceCtx = await resolveCatalogPriceContext(ctx.container, ctx, body.context)
    Object.assign(query, priceCtx.query)
    query.fields = productFields(!!(priceCtx.query.region_id || priceCtx.query.country_code))

    const qstr = qs.stringify(query, { arrayFormat: "brackets", skipNulls: true })
    const url = `${ctx.baseUrl}/store/products?${qstr}`

    const headers: Record<string, string> = { accept: "application/json" }
    if (ctx.publishableKey) headers["x-publishable-api-key"] = ctx.publishableKey

    const resp = await fetch(url, { headers })
    const data = await resp.json() as any

    let products = (data.products || []).map((p: any) =>
      formatUcpProduct(p, { storefrontUrl: ctx.storefrontUrl, currency: priceCtx.currency })
    )

    // Price filter (minor units, denominated in the presentment currency).
    // Medusa's store list doesn't filter on calculated price, so apply it to the
    // returned page and tell the caller — per spec, prices are already minor units.
    const pf = body.filters?.price
    if (pf && (pf.min != null || pf.max != null)) {
      const before = products.length
      products = products.filter((p: any) => {
        const amt = p.price_range?.min?.amount
        if (amt == null) return false
        if (pf.min != null && amt < pf.min) return false
        if (pf.max != null && p.price_range.max.amount > pf.max) return false
        return true
      })
      if (products.length !== before) {
        messages.push({
          type: "info",
          code: "price_filter_applied",
          content: "Price filter applied to the current page of results.",
        })
      }
    }

    const limit = query.limit as number
    const offset = query.offset as number
    const total = typeof data.count === "number" ? data.count : undefined
    const hasNext = total != null ? offset + limit < total : (data.products || []).length === limit

    res.json({
      ucp: catalogEnvelope(),
      products,
      pagination: {
        has_next_page: hasNext,
        ...(total != null ? { total_count: total } : {}),
      },
      ...(messages.length ? { messages } : {}),
      // Legacy fields (back-compat with the first cut of this API).
      count: products.length,
      offset,
      limit,
    })
  } catch (error: any) {
    res.status(500).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "internal_error",
      content: error.message,
    }))
  }
}

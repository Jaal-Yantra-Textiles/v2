import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildUcpContext } from "../../lib/context"
import { formatUcpProduct, UCP_VERSION } from "../../lib/formatter"
import { formatUcpError } from "../../lib/error-formatter"
import { callStoreRoute } from "../../../mcp/lib/proxy"
import qs from "qs"

/**
 * POST /ucp/catalog/search
 *
 * Search the storefront catalog. Supports full-text query and filters.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const ctx = await buildUcpContext(req)
  const body = req.validatedBody as any

  try {
    const query: Record<string, unknown> = {}
    if (body.query) query.q = body.query
    if (body.filters?.category) query.category_id = body.filters.category
    if (body.filters?.collection) query.collection_id = body.filters.collection
    query.limit = body.pagination?.limit ?? 20
    query.offset = body.pagination?.offset ?? 0

    const qstr = qs.stringify(query, { arrayFormat: "brackets", skipNulls: true })
    const url = `${ctx.baseUrl}/store/products?${qstr}`

    const headers: Record<string, string> = { accept: "application/json" }
    if (ctx.publishableKey) headers["x-publishable-api-key"] = ctx.publishableKey

    const resp = await fetch(url, { headers })
    const data = await resp.json() as any

    const products = (data.products || []).map(formatUcpProduct)

    res.json({
      ucp: { version: UCP_VERSION, status: "success" },
      products,
      count: products.length,
      offset: query.offset,
      limit: query.limit,
    })
  } catch (error: any) {
    res.status(500).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "internal_error",
      content: error.message,
    }))
  }
}

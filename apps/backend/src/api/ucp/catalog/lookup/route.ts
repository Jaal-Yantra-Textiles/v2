import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildUcpContext } from "../../lib/context"
import { formatUcpProduct, UCP_VERSION } from "../../lib/formatter"
import { formatUcpError } from "../../lib/error-formatter"

/**
 * POST /ucp/catalog/lookup
 *
 * Look up products by id. Returns full product details including variants.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const ctx = await buildUcpContext(req)
  const body = req.validatedBody as any

  try {
    const ids: string[] = body.ids || []
    const products: any[] = []

    for (const id of ids) {
      try {
        const url = `${ctx.baseUrl}/store/products/${id}`
        const headers: Record<string, string> = { accept: "application/json" }
        if (ctx.publishableKey) headers["x-publishable-api-key"] = ctx.publishableKey

        const resp = await fetch(url, { headers })
        if (resp.ok) {
          const data = await resp.json() as any
          const product = data.product || data
          products.push(formatUcpProduct(product))
        }
      } catch {
        // Skip not found
      }
    }

    res.json({
      ucp: { version: UCP_VERSION, status: "success" },
      products,
      count: products.length,
    })
  } catch (error: any) {
    res.status(500).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "internal_error",
      content: error.message,
    }))
  }
}

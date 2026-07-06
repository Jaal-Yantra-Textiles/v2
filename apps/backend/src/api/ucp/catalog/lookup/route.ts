import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import qs from "qs"
import { buildUcpContext, resolveCatalogPriceContext } from "../../lib/context"
import { formatUcpProduct, catalogEnvelope, UCP_VERSION } from "../../lib/formatter"
import { formatUcpError } from "../../lib/error-formatter"

// Base prices are always safe; calculated_price needs a region/country context.
function productFields(hasRegion: boolean): string {
  return hasRegion
    ? "*variants.calculated_price,*variants.prices"
    : "*variants.prices"
}

/**
 * POST /ucp/catalog/lookup
 *
 * Look up products by id. Returns full product details including variants,
 * priced in the buyer's context currency plus every currency the merchant sets.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const ctx = await buildUcpContext(req)
  const body = req.validatedBody as any

  try {
    const ids: string[] = body.ids || []
    const products: any[] = []

    // Pricing context — required for Medusa to compute calculated_price;
    // otherwise every variant price is null. Also yields the presentment currency.
    const priceCtx = await resolveCatalogPriceContext(ctx.container, ctx, body.context)
    const hasRegion = !!(priceCtx.query.region_id || priceCtx.query.country_code)
    const qstr = qs.stringify(
      { fields: productFields(hasRegion), ...priceCtx.query },
      { skipNulls: true }
    )

    for (const id of ids) {
      try {
        const url = `${ctx.baseUrl}/store/products/${id}${qstr ? `?${qstr}` : ""}`
        const headers: Record<string, string> = { accept: "application/json" }
        if (ctx.publishableKey) headers["x-publishable-api-key"] = ctx.publishableKey

        const resp = await fetch(url, { headers })
        if (resp.ok) {
          const data = await resp.json() as any
          const product = data.product || data
          products.push(
            formatUcpProduct(product, {
              storefrontUrl: ctx.storefrontUrl,
              currency: priceCtx.currency,
            })
          )
        }
      } catch {
        // Skip not found
      }
    }

    res.json({
      ucp: catalogEnvelope(),
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

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildUcpContext } from "../../lib/context"
import { formatUcpOrder, UCP_VERSION } from "../../lib/formatter"
import { formatUcpError } from "../../lib/error-formatter"
import { callStoreRoute } from "../../../mcp/lib/proxy"

/**
 * GET /ucp/orders/:id
 *
 * Retrieve an order by id.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const ctx = await buildUcpContext(req)

  try {
    const data = await callStoreRoute({
      baseUrl: ctx.baseUrl,
      method: "GET",
      path: `/store/orders/${id}`,
      publishableKey: ctx.publishableKey,
    }) as any

    const order = data?.order || data

    if (!order || !order.id) {
      res.status(404).json(formatUcpError({
        ucpVersion: UCP_VERSION,
        code: "not_found",
        content: "Order not found",
      }))
      return
    }

    const formatted = formatUcpOrder(
      { storeName: ctx.storeName, storefrontUrl: ctx.storefrontUrl, baseUrl: ctx.baseUrl },
      order
    )

    res.json(formatted)
  } catch (error: any) {
    if (error?.status === 404) {
      res.status(404).json(formatUcpError({
        ucpVersion: UCP_VERSION,
        code: "not_found",
        content: "Order not found",
      }))
      return
    }
    res.status(500).json(formatUcpError({
      ucpVersion: UCP_VERSION,
      code: "internal_error",
      content: error.message,
    }))
  }
}

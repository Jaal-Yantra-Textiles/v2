import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { resolveDryRun } from "../../../../lib/mcp-core/resolve-dry-run"
import { bulkUpdateProducts } from "../../../../workflows/products/bulk-update-products"
import type { BulkUpdateProductsReq } from "./validators"

/**
 * POST /admin/products/bulk-update
 *
 * Update many products, their variants and their stock levels in one call —
 * including turning inventory tracking ON, which core cannot do for an
 * existing variant (see `bulk-update-products.ts` for why).
 *
 * Responds 200 with a PER-ROW outcome even when some rows failed: one bad id
 * in a two-hundred-row batch must not discard the rest. Read `variants` /
 * `products` / `warnings`, not the status code.
 *
 * `preview: true` (or `dry_run: true`) returns the same plan without writing,
 * including the before/after quantity and the reserved stock at each location.
 *
 * Both spellings mean the same thing. `preview` exists because the MCP
 * dispatcher consumes `dry_run` itself and answers with a planned HTTP request
 * without ever calling this route — so over MCP, `dry_run` can never surface
 * the per-row plan below, and `preview` is the only spelling that arrives
 * (#1877). Defaults to APPLY, unlike the maintenance-job surface: this route
 * has been apply-by-default since it shipped and flipping that would turn
 * every existing caller's write into a silent no-op.
 *
 * Unscoped by design — this is the admin surface and reaches the whole
 * platform. Mirrored, store-scoped, by
 * POST /partners/stores/:id/products/bulk-update.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const body = (req as any).validatedBody as BulkUpdateProductsReq

  const result = await bulkUpdateProducts(req.scope, {
    ...body,
    dry_run: resolveDryRun(body, false),
  })

  res.status(200).json(result)
}

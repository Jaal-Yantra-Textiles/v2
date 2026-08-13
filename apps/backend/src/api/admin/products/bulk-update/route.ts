import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

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
 * `dry_run: true` returns the same plan without writing, including the
 * before/after quantity and the reserved stock at each location.
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

  const result = await bulkUpdateProducts(req.scope, body)

  res.status(200).json(result)
}

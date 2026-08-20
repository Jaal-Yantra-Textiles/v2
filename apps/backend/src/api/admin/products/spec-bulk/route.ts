import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { bulkUpsertProductSpecs } from "../../../../workflows/products/bulk-upsert-product-specs"
import type { BulkProductSpecReqType } from "./validators"

/**
 * POST /admin/products/spec-bulk
 *
 * Write a production spec across many products in one call.
 *
 * Responds 200 with a PER-ROW outcome even when some rows failed — one bad
 * product id must not discard the rest of the batch. Read `results`, not the
 * status code.
 *
 * `dry_run: true` returns the same plan without writing, and each row says
 * whether it would CREATE or UPDATE, plus which of `colors`/`fields`/`options`
 * it would REPLACE wholesale.
 *
 * Unscoped by design — this is the admin surface and reaches the whole
 * platform. Mirrored, ownership-scoped, by POST /partners/products/spec-bulk.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const body = (req as any).validatedBody as BulkProductSpecReqType

  const result = await bulkUpsertProductSpecs(req.scope, body)

  res.status(200).json(result)
}

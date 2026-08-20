import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { assertProductOwnership } from "../lib/assert-product-ownership"
import { bulkUpsertProductSpecs } from "../../../../workflows/products/bulk-upsert-product-specs"
import type { BulkProductSpecReqType } from "../../../admin/products/spec-bulk/validators"

/**
 * POST /partners/products/spec-bulk
 *
 * Partner mirror of `POST /admin/products/spec-bulk`: write a production spec
 * across many of the partner's OWN products in one call.
 *
 * Ownership is resolved per id through `assertProductOwnership` — the same
 * helper the single-product spec route uses, called once per row rather than
 * reimplemented as a set query. That is deliberate and its own docblock says
 * why: an ownership rule that exists in two copies is one edit away from
 * disagreeing with itself, and the copy that drifts is the one that lets a
 * partner write someone else's catalogue. A batch route is the worst possible
 * place to hold the drifting copy, because it would reach a hundred products
 * before anyone noticed.
 *
 * Ids that fail the check become error rows saying "not found" — the same
 * wording an id that genuinely does not exist produces, so a partner cannot use
 * this route to discover that a product belongs to someone else.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const body = (req as any).validatedBody as BulkProductSpecReqType

  const requested = Array.from(
    new Set((body.products ?? []).map((p) => p.product_id))
  )

  const allowedProductIds = new Set<string>()
  for (const productId of requested) {
    try {
      await assertProductOwnership(req, productId)
      allowedProductIds.add(productId)
    } catch {
      // Left out of the allow-set; the workflow turns that into an error row.
      // Swallowed rather than thrown so one foreign id cannot discard a batch
      // of ninety-nine legitimate ones.
    }
  }

  const result = await bulkUpsertProductSpecs(req.scope, body, {
    allowedProductIds,
  })

  res.status(200).json(result)
}

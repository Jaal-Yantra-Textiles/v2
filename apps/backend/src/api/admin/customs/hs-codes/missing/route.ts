import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { scanMissingHsCodes } from "../../../../../workflows/customs/hs-codes"

/**
 * GET /admin/customs/hs-codes/missing
 *
 * Catalogue items that would fail an international label for want of an HSN.
 * Read-only. Each row carries the context needed to propose a code (title,
 * description, material, type, categories) and the level a code SHOULD be
 * written at, so a caller never has to re-derive the placement rule.
 *
 * Mirrored by GET /partners/stores/:id/customs/hs-codes/missing.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const result = await scanMissingHsCodes(req.scope, {
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  })

  res.status(200).json(result)
}

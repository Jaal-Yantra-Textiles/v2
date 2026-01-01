import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * POST /admin/meta-ads/remote/ads
 *
 * Placeholder endpoint for future: create Meta ads using custom data.
 *
 * Not implemented yet by design.
 */
export const POST = async (_req: MedusaRequest, _res: MedusaResponse) => {
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    "Remote ad creation is not implemented yet"
  )
}

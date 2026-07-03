import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runArtisanApproval } from "../../lib/run-approval"

/**
 * Reject an artisan's proposed product (#859 S2 / #861).
 *
 * @route POST /admin/partners/products/:id/reject
 * Sets status `rejected` and emits `partner_product.rejected`. The cross-list
 * subscriber ignores rejected products.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  return runArtisanApproval(req, res, "reject")
}

import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runArtisanApproval } from "../../lib/run-approval"

/**
 * Approve an artisan's proposed product (#859 S2 / #861).
 *
 * @route POST /admin/partners/products/:id/approve
 * Publishes the product and emits `partner_product.approved`, which the
 * cross-list subscriber uses to attach the core sales channel.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  return runArtisanApproval(req, res, "approve")
}

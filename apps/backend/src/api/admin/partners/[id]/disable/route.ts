import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { disablePartnerWorkflow } from "../../../../../workflows/partners/disable-partner"

/**
 * POST /admin/partners/:id/disable
 *
 * Disable a partner without deleting them: take their storefront domain(s) down
 * and flip `status` to `inactive`. Products, orders, admins and the hosting
 * project all survive, so the partner can be re-enabled later (via
 * `PUT /admin/partners/:id` with `status: "active"`).
 *
 * This is the admin-side counterpart to the storefront teardown in
 * `DELETE /partners/storefront`, but scoped to "off, not gone": it detaches the
 * domains and leaves the project standing.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const id = req.params.id

  const { result } = await disablePartnerWorkflow(req.scope).run({
    input: { id },
  })

  res.status(200).json({ partner: result.partner, storefront: result.storefront })
}
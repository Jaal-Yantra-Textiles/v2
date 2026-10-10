import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { verifyPartnerStorefrontDomain } from "../../../../../../../workflows/stores/verify-storefront-domain"

/**
 * @route POST /admin/partners/:id/storefront/verify-domain
 * @scope admin
 *
 * Verify the partner's provisioned storefront subdomain (e.g.
 * shramdaan.cicilabel.com): publishes Vercel's `_vercel` TXT challenge in our
 * Cloudflare zone — added beside the other stores' records, never replacing
 * one — and asks Vercel to verify. Idempotent; safe to call repeatedly while
 * DNS propagates. (The sibling `/storefront/domain/verify` handles a
 * partner's CUSTOM domain.)
 *
 * Success: 200 -> { check: { domain, verified, txt[], error? } }
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "partners",
    fields: ["id", "name", "storefront_domain", "vercel_project_id", "metadata"],
    filters: { id: req.params.id },
  })
  const partner = data?.[0]
  if (!partner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Partner ${req.params.id} not found`)
  }
  const check = await verifyPartnerStorefrontDomain(req.scope, partner)
  return res.status(200).json({ check })
}

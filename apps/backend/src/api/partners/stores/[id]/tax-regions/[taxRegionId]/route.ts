import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: taxRegions } = await query.graph({
    entity: "tax_regions",
    fields: ["*", "tax_rates.*", "children.*", "children.tax_rates.*"],
    filters: { id: req.params.taxRegionId },
  })

  if (!taxRegions?.[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Tax region not found")
  }

  res.json({ tax_region: taxRegions[0] })
}

/**
 * POST (update) is intentionally refused. See the parent route's POST
 * for the full rationale — tax regions are admin-managed shared catalog
 * data; mutating one would change tax behavior for every partner
 * pointing at it.
 */
export const POST = async (
  _req: AuthenticatedMedusaRequest,
  _res: MedusaResponse
) => {
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    "Partners cannot modify shared tax regions. Contact admin to adjust the tax region for this jurisdiction."
  )
}

/**
 * DELETE is intentionally refused.
 *
 * Unlike regions (where DELETE dismisses the partner ↔ region link without
 * touching the region row), tax_regions have no partner-scoped link to
 * dismiss — the GET filters them by the partner's region countries. So
 * "DELETE a tax region" can only mean deleting the global row, which would
 * remove tax for every partner in that country.
 *
 * Admin manages the catalog; partners cannot delete from it.
 */
export const DELETE = async (
  _req: AuthenticatedMedusaRequest,
  _res: MedusaResponse
) => {
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    "Partners cannot delete shared tax regions. Contact admin if a tax region should be removed."
  )
}

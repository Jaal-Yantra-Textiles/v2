import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { deleteTaxRegionsWorkflow } from "@medusajs/medusa/core-flows"
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

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const body = req.body as Record<string, any>
  const taxService = req.scope.resolve(Modules.TAX) as any
  const updated = await taxService.updateTaxRegions({
    id: req.params.taxRegionId,
    ...body,
  })

  res.json({ tax_region: updated })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  await deleteTaxRegionsWorkflow(req.scope).run({ input: { ids: [req.params.taxRegionId] } })

  res.json({ id: req.params.taxRegionId, object: "tax_region", deleted: true })
}

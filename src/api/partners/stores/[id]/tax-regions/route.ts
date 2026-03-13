import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createTaxRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Tax regions are linked to the store's country codes via its default region
  const filters: Record<string, any> = {}
  if (store.default_region_id) {
    const { data: regions } = await query.graph({
      entity: "regions",
      fields: ["countries.iso_2"],
      filters: { id: store.default_region_id },
    })
    const countryCodes = regions?.[0]?.countries?.map((c: any) => c.iso_2) || []
    if (countryCodes.length) {
      filters.country_code = countryCodes
    }
  }

  const { data: taxRegions } = await query.graph({
    entity: "tax_regions",
    fields: ["*", "tax_rates.*", "children.*"],
    ...(Object.keys(filters).length ? { filters } : {}),
  })

  res.json({
    tax_regions: taxRegions || [],
    count: taxRegions?.length || 0,
    offset: 0,
    limit: 20,
  })
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

  const { result } = await createTaxRegionsWorkflow(req.scope).run({
    input: [body] as any,
  })

  res.status(201).json({ tax_region: result[0] })
}

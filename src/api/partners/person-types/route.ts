import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"
import associatePartnerPersonTypesWorkflow from "../../../workflows/partner/associate-partner-person-types"

/**
 * GET /partners/person-types
 * List person types linked to the current partner.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "partner",
    fields: ["id", "person_types.id", "person_types.name", "person_types.description"],
    filters: { id: partner.id },
  })

  const result = data?.[0] as any

  return res.json({
    person_types: result?.person_types || [],
    count: (result?.person_types || []).length,
  })
}

/**
 * POST /partners/person-types
 * Set person types for the current partner (replaces existing).
 * Body: { person_type_ids: string[] }
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  const body = (req as any).validatedBody || req.body
  const personTypeIds = body?.person_type_ids as string[]

  if (!Array.isArray(personTypeIds)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "person_type_ids array is required"
    )
  }

  // Verify all person types exist
  if (personTypeIds.length > 0) {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: types } = await query.graph({
      entity: "person_type",
      fields: ["id"],
      filters: { id: personTypeIds },
    })
    const foundIds = new Set((types || []).map((t: any) => t.id))
    const missing = personTypeIds.filter((id) => !foundIds.has(id))
    if (missing.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `PersonType(s) not found: ${missing.join(", ")}`
      )
    }
  }

  await associatePartnerPersonTypesWorkflow(req.scope).run({
    input: { partnerId: partner.id, personTypeIds },
  })

  // Re-fetch
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "partner",
    fields: ["id", "person_types.id", "person_types.name", "person_types.description"],
    filters: { id: partner.id },
  })

  const result = data?.[0] as any

  return res.json({
    person_types: result?.person_types || [],
    count: (result?.person_types || []).length,
  })
}

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../../../../modules/partner"
import { PERSON_TYPE_MODULE } from "../../../../../modules/persontype"
import associatePartnerPersonTypesWorkflow from "../../../../../workflows/partner/associate-partner-person-types"

/**
 * GET /admin/partners/:id/person-types
 * List person types linked to a partner.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: partnerData } = await query.graph({
    entity: "partner",
    fields: [
      "id",
      "person_types.id",
      "person_types.name",
      "person_types.description",
    ],
    filters: { id: partnerId },
  })

  const partner = partnerData?.[0] as any
  if (!partner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Partner not found")
  }

  return res.json({
    person_types: partner.person_types || [],
    count: (partner.person_types || []).length,
  })
}

/**
 * POST /admin/partners/:id/person-types
 * Set person types for a partner (replaces existing).
 * Body: { person_type_ids: string[] }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params
  const body = (req as any).validatedBody || req.body
  const personTypeIds = body?.person_type_ids as string[]

  if (!Array.isArray(personTypeIds)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "person_type_ids array is required"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Verify partner exists
  const { data: partners } = await query.graph({
    entity: "partner",
    fields: ["id"],
    filters: { id: partnerId },
  })
  if (!partners?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Partner not found")
  }

  // Verify all person types exist
  if (personTypeIds.length > 0) {
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
    input: { partnerId, personTypeIds },
  })

  // Re-fetch to return current state
  const { data: updated } = await query.graph({
    entity: "partner",
    fields: ["id", "person_types.id", "person_types.name", "person_types.description"],
    filters: { id: partnerId },
  })

  const partner = updated?.[0] as any

  return res.json({
    person_types: partner?.person_types || [],
    count: (partner?.person_types || []).length,
  })
}

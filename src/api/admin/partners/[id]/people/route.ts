import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../../../../modules/partner"
import { PERSON_MODULE } from "../../../../../modules/person"

/**
 * GET /admin/partners/:id/people
 * List persons linked to a partner.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: partnerData } = await query.graph({
    entity: "partner",
    fields: [
      "id",
      "name",
      "people.id",
      "people.first_name",
      "people.last_name",
      "people.email",
      "people.state",
      "people.avatar",
      "people.created_at",
    ],
    filters: { id: partnerId },
  })

  const partner = partnerData?.[0] as any
  if (!partner) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Partner not found")
  }

  return res.json({
    people: partner.people || [],
    count: (partner.people || []).length,
  })
}

/**
 * POST /admin/partners/:id/people
 * Link existing persons to a partner.
 * Body: { person_ids: string[] }
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params
  const body = (req as any).validatedBody || req.body
  const personIds = body?.person_ids as string[]

  if (!Array.isArray(personIds) || !personIds.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "person_ids array is required"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK)

  // Verify partner exists
  const { data: partners } = await query.graph({
    entity: "partner",
    fields: ["id"],
    filters: { id: partnerId },
  })
  if (!partners?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Partner not found")
  }

  // Verify all persons exist
  const { data: persons } = await query.graph({
    entity: "person",
    fields: ["id"],
    filters: { id: personIds },
  })
  const foundIds = new Set((persons || []).map((p: any) => p.id))
  const missing = personIds.filter((id) => !foundIds.has(id))
  if (missing.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Person(s) not found: ${missing.join(", ")}`
    )
  }

  // Create links
  for (const personId of personIds) {
    await remoteLink.create({
      [PARTNER_MODULE]: { partner_id: partnerId },
      [PERSON_MODULE]: { person_id: personId },
    })
  }

  return res.json({
    partner_id: partnerId,
    person_ids: personIds,
    linked: true,
  })
}

/**
 * DELETE /admin/partners/:id/people
 * Unlink persons from a partner.
 * Body: { person_ids: string[] }
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params
  const body = (req as any).validatedBody || req.body
  const personIds = body?.person_ids as string[]

  if (!Array.isArray(personIds) || !personIds.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "person_ids array is required"
    )
  }

  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK)

  for (const personId of personIds) {
    await remoteLink.dismiss({
      [PARTNER_MODULE]: { partner_id: partnerId },
      [PERSON_MODULE]: { person_id: personId },
    })
  }

  return res.json({
    partner_id: partnerId,
    person_ids: personIds,
    linked: false,
  })
}

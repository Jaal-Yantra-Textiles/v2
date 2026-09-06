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

  /*
   * 🔴 `query.graph` returns a NULL in place of every link row whose target
   * no longer exists, so a partner carrying four dangling `people` links
   * answered `{"people":[null,null,null,null],"count":4}`. The admin's
   * PartnerPeopleSection mapped over that and read `.id` off a null, which
   * took the WHOLE partner detail page down — not the section, the page:
   * "An unexpected error occurred while rendering this page". Measured on
   * `01M1RHS2347F5D9MYBPF3AB5SS` locally. This is #1857's dangling link rows
   * arriving at a reader that trusted the link table.
   *
   * The nulls are dropped rather than forwarded, and counted separately.
   * `count` now means "people you can actually open", which is what every
   * caller already assumed it meant. A link row is not a record — and
   * `dangling` says so out loud instead of quietly shrinking the list.
   */
  const rows = (partner.people || []) as (Record<string, any> | null)[]
  const people = rows.filter((p): p is Record<string, any> => !!p?.id)

  return res.json({
    people,
    count: people.length,
    dangling: rows.length - people.length,
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

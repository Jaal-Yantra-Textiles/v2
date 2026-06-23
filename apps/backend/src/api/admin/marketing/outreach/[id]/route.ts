/**
 * GET    /admin/marketing/outreach/:id  — retrieve one outreach row
 * POST   /admin/marketing/outreach/:id  — update CRM fields (status/notes/…)
 * DELETE /admin/marketing/outreach/:id  — remove an outreach row
 *
 * Single-record CRUD mirrors `inbound-emails/[id]/route.ts`. POST (rather than
 * PATCH) is used for update to stay consistent with the admin SDK conventions
 * elsewhere in this codebase. Body is parsed manually with the route validator
 * (no middleware — see the list route header).
 */

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { MARKETING_MODULE } from "../../../../../modules/marketing"
import { updateOutreachBodySchema } from "../validators"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const service = req.scope.resolve(MARKETING_MODULE) as any

  const outreach = await service.retrieveMarketingOutreach(id).catch(() => null)

  if (!outreach) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Marketing outreach ${id} not found`
    )
  }

  res.status(200).json({ outreach })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const service = req.scope.resolve(MARKETING_MODULE) as any

  const parsed = updateOutreachBodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res
      .status(400)
      .json({ message: parsed.error.issues[0]?.message ?? "Invalid body" })
    return
  }

  const existing = await service
    .retrieveMarketingOutreach(id)
    .catch(() => null)
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Marketing outreach ${id} not found`
    )
  }

  const updated = await service.updateMarketingOutreaches({
    id,
    ...parsed.data,
  })

  res.status(200).json({ outreach: updated })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const service = req.scope.resolve(MARKETING_MODULE) as any

  const existing = await service
    .retrieveMarketingOutreach(id)
    .catch(() => null)
  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Marketing outreach ${id} not found`
    )
  }

  await service.deleteMarketingOutreaches(id)

  res.status(200).json({ id, object: "marketing_outreach", deleted: true })
}

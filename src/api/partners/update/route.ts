import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import updatePartnerWorkflow from "../../../workflows/partners/update-partner"
import { getPartnerFromActorId } from "../helpers"

// Update the partner that the current admin belongs to
export const PUT = async (
  req: AuthenticatedMedusaRequest<{
    name?: string
    handle?: string
    logo?: string | null
    status?: "active" | "inactive" | "pending"
    is_verified?: boolean
    metadata?: Record<string, any> | null
  }>,
  res: MedusaResponse
) => {
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  const partner = await getPartnerFromActorId(actorId, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Partner not found for this admin"
    )
  }

  const { result, errors } = await updatePartnerWorkflow(req.scope).run({
    input: {
      id: partner.id,
      data: req.validatedBody || (req.body as any) || {},
    },
  })

  if (errors.length > 0) {
    return res.status(400).json({ errors })
  }

  return res.status(200).json({ partner: result })
}

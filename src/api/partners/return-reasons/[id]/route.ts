import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import partnerReturnReasonLink from "../../../../links/partner-return-reason"

// Verify the return reason belongs to this partner
async function verifyOwnership(req: AuthenticatedMedusaRequest) {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner not found")

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data: links } = await query.graph({
    entity: partnerReturnReasonLink.entryPoint,
    filters: { partner_id: partner.id, return_reason_id: req.params.id },
    fields: ["return_reason_id"],
  })

  if (!links?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Return reason not found")
  }

  return partner
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  await verifyOwnership(req)
  const orderModule = req.scope.resolve(Modules.ORDER) as any
  const reason = await orderModule.retrieveReturnReason(req.params.id)
  res.json({ return_reason: reason })
}

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  await verifyOwnership(req)
  const orderModule = req.scope.resolve(Modules.ORDER) as any
  const body = req.body as { value?: string; label?: string; description?: string }
  const reason = await orderModule.updateReturnReasons({ id: req.params.id, ...body })
  res.json({ return_reason: reason })
}

export const DELETE = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await verifyOwnership(req)
  const orderModule = req.scope.resolve(Modules.ORDER) as any
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any

  // Remove the link first
  await remoteLink.dismiss({
    partner: { partner_id: partner.id },
    [Modules.ORDER]: { return_reason_id: req.params.id },
  })

  // Delete the reason
  await orderModule.deleteReturnReasons([req.params.id])
  res.json({ id: req.params.id, object: "return_reason", deleted: true })
}

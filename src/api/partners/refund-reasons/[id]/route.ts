import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"

async function verifyOwnership(req: AuthenticatedMedusaRequest) {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner not found")

  const orderModule = req.scope.resolve(Modules.ORDER) as any
  const reason = await orderModule.retrieveRefundReason(req.params.id)

  if (!reason) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Refund reason not found")
  }

  // Check ownership via metadata (global reasons without partner_id are shared/read-only)
  const ownerId = reason.metadata?.partner_id
  if (ownerId && ownerId !== partner.id) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Refund reason not found")
  }

  return { partner, reason, isOwner: ownerId === partner.id }
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { reason } = await verifyOwnership(req)
  res.json({ refund_reason: reason })
}

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { isOwner } = await verifyOwnership(req)
  if (!isOwner) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Cannot edit shared refund reasons")
  }

  const orderModule = req.scope.resolve(Modules.ORDER) as any
  const body = req.body as { label?: string; description?: string }
  const reason = await orderModule.updateRefundReasons({ id: req.params.id, ...body })
  res.json({ refund_reason: reason })
}

export const DELETE = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const { isOwner } = await verifyOwnership(req)
  if (!isOwner) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Cannot delete shared refund reasons")
  }

  const orderModule = req.scope.resolve(Modules.ORDER) as any
  await orderModule.deleteRefundReasons([req.params.id])
  res.json({ id: req.params.id, object: "refund_reason", deleted: true })
}

import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner not found")
  }

  const orderModule = req.scope.resolve(Modules.ORDER) as any
  const allReasons = await orderModule.listRefundReasons(
    {},
    { take: 500, order: { created_at: "ASC" } }
  )

  // Filter: partner's own + global (no partner_id)
  const reasons = allReasons.filter((r: any) => {
    const ownerId = r.metadata?.partner_id
    return !ownerId || ownerId === partner.id
  })

  res.json({ refund_reasons: reasons, count: reasons.length })
}

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner not found")
  }

  const orderModule = req.scope.resolve(Modules.ORDER) as any
  const body = req.body as { label: string; description?: string }

  const reason = await orderModule.createRefundReasons({
    ...body,
    metadata: { partner_id: partner.id },
  })

  res.status(201).json({ refund_reason: reason })
}

import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"
import partnerReturnReasonLink from "../../../links/partner-return-reason"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner not found")
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  // Fetch return reasons linked to this partner
  const { data: links } = await query.graph({
    entity: partnerReturnReasonLink.entryPoint,
    filters: { partner_id: partner.id },
    fields: ["return_reason_id", "return_reason.*"],
  })

  const reasons = (links || [])
    .map((l: any) => l.return_reason)
    .filter(Boolean)

  res.json({ return_reasons: reasons, count: reasons.length })
}

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner not found")
  }

  const orderModule = req.scope.resolve(Modules.ORDER) as any
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  const body = req.body as { value: string; label: string; description?: string }

  // Create the return reason
  const reason = await orderModule.createReturnReasons(body)

  // Link it to the partner
  await remoteLink.create({
    partner: { partner_id: partner.id },
    [Modules.ORDER]: { return_reason_id: (reason as any).id },
  })

  res.status(201).json({ return_reason: reason })
}

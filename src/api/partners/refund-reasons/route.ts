import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createRefundReasonsWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext } from "../helpers"
import partnerRefundReasonLink from "../../../links/partner-refund-reason"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner not found")
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Get refund reasons linked to this partner
  const { data: links } = await query.graph({
    entity: partnerRefundReasonLink.entryPoint,
    filters: { partner_id: partner.id },
    fields: ["refund_reason_id", "refund_reason.*"],
  })

  const reasons = (links || [])
    .map((l: any) => l.refund_reason)
    .filter(Boolean)

  res.json({ refund_reasons: reasons, count: reasons.length })
}

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner not found")
  }

  const body = req.body as { label: string; description?: string }

  const { result: [refundReason] } = await createRefundReasonsWorkflow(req.scope).run({
    input: { data: [body] },
  })

  // Link refund reason to partner
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.create({
    partner: { partner_id: partner.id },
    [Modules.PAYMENT]: { refund_reason_id: refundReason.id },
  })

  res.status(201).json({ refund_reason: refundReason })
}

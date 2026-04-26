import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { updateRefundReasonsWorkflow, deleteRefundReasonsWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerFromAuthContext } from "../../helpers"
import partnerRefundReasonLink from "../../../../links/partner-refund-reason"

async function verifyOwnership(req: AuthenticatedMedusaRequest) {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner not found")

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: links } = await query.graph({
    entity: partnerRefundReasonLink.entryPoint,
    filters: { partner_id: partner.id, refund_reason_id: req.params.id },
    fields: ["refund_reason_id"],
  })

  if (!links?.length) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Refund reason not found")
  }

  return partner
}

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  await verifyOwnership(req)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: reasons } = await query.graph({
    entity: "refund_reason",
    filters: { id: req.params.id },
    fields: ["*"],
  })

  if (!reasons?.[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Refund reason not found")
  }

  res.json({ refund_reason: reasons[0] })
}

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  await verifyOwnership(req)

  const body = req.body as { label?: string; description?: string }

  await updateRefundReasonsWorkflow(req.scope).run({
    input: [{ ...body, id: req.params.id }],
  })

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: reasons } = await query.graph({
    entity: "refund_reason",
    filters: { id: req.params.id },
    fields: ["*"],
  })

  res.json({ refund_reason: reasons[0] })
}

export const DELETE = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const partner = await verifyOwnership(req)

  // Remove the link first
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.dismiss({
    partner: { partner_id: partner.id },
    [Modules.PAYMENT]: { refund_reason_id: req.params.id },
  })

  // Delete the reason
  await deleteRefundReasonsWorkflow(req.scope).run({
    input: { ids: [req.params.id] },
  })

  res.json({ id: req.params.id, object: "refund_reason", deleted: true })
}

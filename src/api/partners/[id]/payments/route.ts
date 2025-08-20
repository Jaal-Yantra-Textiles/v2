import { AuthenticatedMedusaRequest, MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { refetchPartnerForThisAdmin } from "../../helpers"
import { ListPaymentsByPartnerQuery } from "./validators"
import partnerPaymentsLink from "../../../../links/partner-payments-link"

// GET /api/partners/:id/payments - List all payments linked to a partner (self)
export const GET = async (
  req: AuthenticatedMedusaRequest<ListPaymentsByPartnerQuery>,
  res: MedusaResponse
) => {
  const { id: partner_id } = req.params

  // AuthZ: ensure the current admin belongs to this partner
  const adminId = req.auth_context?.actor_id
  if (!adminId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Unauthorized")
  }
  const partner = await refetchPartnerForThisAdmin(adminId, req.scope)
  if (!partner || partner.id !== partner_id) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Forbidden: partner mismatch")
  }

  const { offset = 0, limit = 50 } = (req.validatedQuery || {}) as Partial<ListPaymentsByPartnerQuery>
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: partnerPaymentsLink.entryPoint,
    fields: ["internal_payments.*", "partner.*"],
    filters: { partner_id },
  })

  const all = (data || []).map((r: any) => r.internal_payments).filter(Boolean)
  const payments = all.slice(offset, offset + limit)
  return res.status(200).json({ payments, count: all.length, offset, limit })
}

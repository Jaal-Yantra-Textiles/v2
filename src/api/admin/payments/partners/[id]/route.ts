import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import PartnerPaymentsLink from "../../../../../links/partner-payments-link"
import { ListPaymentsByPartnerQuery } from "./validators"

// GET /admin/payments/partners/:id - List all payments linked to a partner
export const GET = async (req: MedusaRequest<ListPaymentsByPartnerQuery>, res: MedusaResponse) => {
  const { id: partner_id } = req.params
  const { offset = 0, limit = 50 } = (req.validatedQuery || {}) as Partial<ListPaymentsByPartnerQuery>
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: PartnerPaymentsLink.entryPoint,
    fields: ["internal_payments.*", "partner.*"],
    filters: { partner_id },
  })

  const all = (data || []).map((r: any) => r.internal_payments).filter(Boolean)
  const payments = all.slice(offset, offset + limit)
  return res.status(200).json({ payments, count: all.length, offset, limit })
}

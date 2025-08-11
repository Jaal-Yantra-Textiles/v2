import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import PersonPaymentsLink from "../../../../../links/person-payments-link"
import { ListPaymentsByPersonQuery } from "./validators"

// GET /admin/payments/persons/:id - List all payments linked to a person
export const GET = async (req: MedusaRequest<ListPaymentsByPersonQuery>, res: MedusaResponse) => {
  const { id: person_id } = req.params
  const { offset = 0, limit = 50 } = (req.validatedQuery || {}) as Partial<ListPaymentsByPersonQuery>
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: PersonPaymentsLink.entryPoint,
    fields: ["internal_payments.*", "person.*"],
    filters: { person_id },
  })

  const all = (data || []).map((r: any) => r.internal_payments).filter(Boolean)
  const payments = all.slice(offset, offset + limit)
  return res.status(200).json({ payments, count: all.length, offset, limit })
}

import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import PersonPaymentMethodsLink from "../../../../../../links/person-payment-methods-link"
import { ListPaymentMethodsByPersonQuery, CreatePaymentMethodForPerson } from "./validators"
import { createPaymentMethodAndLinkWorkflow } from "../../../../../../workflows/payment_methods/create-payment-method-and-link"

// GET /admin/payments/persons/:id/methods - List payment methods linked to a person
export const GET = async (
  req: MedusaRequest<ListPaymentMethodsByPersonQuery>,
  res: MedusaResponse
) => {
  const { id: person_id } = req.params
  const { offset = 0, limit = 50 } = (req.validatedQuery || {}) as Partial<ListPaymentMethodsByPersonQuery>

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: PersonPaymentMethodsLink.entryPoint,
    fields: ["internal_payment_details.*", 'person.*'],
    filters: { person_id },
  })
  const all = (data || [])
    .map((r: any) => r.internal_payment_details)
    .filter(Boolean)
  const paymentMethods = all.slice(offset, offset + limit)
  return res.status(200).json({ paymentMethods, count: all.length, offset, limit })
}

// POST /admin/payments/persons/:id/methods - Create a payment method and link it to the person
export const POST = async (
  req: MedusaRequest<CreatePaymentMethodForPerson>,
  res: MedusaResponse
) => {
  const { id: person_id } = req.params
  const body = req.validatedBody

  const { result, errors } = await createPaymentMethodAndLinkWorkflow(req.scope).run({
    input: {
      ...body,
      person_id,
    },
  })

  if (errors.length > 0) {
    throw errors
  }

  return res.status(201).json({ paymentMethod: result })
}

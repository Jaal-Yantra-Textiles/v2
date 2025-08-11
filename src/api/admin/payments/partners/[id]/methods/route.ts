import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import PartnerPaymentMethodsLink from "../../../../../../links/partner-payment-methods-link"
import { ListPaymentMethodsByPartnerQuery, CreatePaymentMethodForPartner } from "./validators"
import { createPaymentMethodAndLinkWorkflow } from "../../../../../../workflows/payment_methods/create-payment-method-and-link"

// GET /admin/payments/partners/:id/methods - List payment methods linked to a partner
export const GET = async (
  req: MedusaRequest<ListPaymentMethodsByPartnerQuery>,
  res: MedusaResponse
) => {
  const { id: partner_id } = req.params
  const { offset = 0, limit = 50 } = (req.validatedQuery || {}) as Partial<ListPaymentMethodsByPartnerQuery>

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: PartnerPaymentMethodsLink.entryPoint,
    fields: ["internal_payment_details.*", "partner.*"],
    filters: { partner_id },
  })

  const all = (data || [])
    .map((r: any) => r.internal_payment_details)
    .filter(Boolean)
  const paymentMethods = all.slice(offset, offset + limit)
  return res.status(200).json({ paymentMethods, count: all.length, offset, limit })
}

// POST /admin/payments/partners/:id/methods - Create a payment method and link it to the partner
export const POST = async (
  req: MedusaRequest<CreatePaymentMethodForPartner>,
  res: MedusaResponse
) => {
  const { id: partner_id } = req.params
  const body = req.validatedBody

  const { result, errors } = await createPaymentMethodAndLinkWorkflow(req.scope).run({
    input: {
      ...body,
      partner_id,
    },
  })

  if (errors.length > 0) {
    throw errors
  }

  return res.status(201).json({ paymentMethod: result })
}

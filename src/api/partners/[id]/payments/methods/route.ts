import { AuthenticatedMedusaRequest, MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import PartnerPaymentMethodsLink from "../../../../../links/partner-payment-methods-link"
import {
  ListPaymentMethodsByPartnerQuery,
  CreatePaymentMethodForPartner,
} from "../validators"
import { createPaymentMethodAndLinkWorkflow } from "../../../../../workflows/payment_methods/create-payment-method-and-link"
import { refetchPartnerForThisAdmin } from "../../../helpers"

// GET /api/partners/:id/payments/methods - List payment methods linked to a partner (self)
export const GET = async (
  req: AuthenticatedMedusaRequest<ListPaymentMethodsByPartnerQuery>,
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

  const { offset = 0, limit = 50 } = (req.validatedQuery || {}) as Partial<ListPaymentMethodsByPartnerQuery>

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: PartnerPaymentMethodsLink.entryPoint,
    fields: ["internal_payment_details.*", "partner.*"],
    filters: { partner_id },
  })

  const all = (data || []).map((r: any) => r.internal_payment_details).filter(Boolean)
  const paymentMethods = all.slice(offset, offset + limit)
  return res.status(200).json({ paymentMethods, count: all.length, offset, limit })
}

// POST /api/partners/:id/payments/methods - Create a payment method and link it to the partner (self)
export const POST = async (
  req: AuthenticatedMedusaRequest<CreatePaymentMethodForPartner>,
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

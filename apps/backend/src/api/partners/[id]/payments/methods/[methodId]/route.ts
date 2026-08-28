import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../../helpers"
import PartnerPaymentMethodsLink from "../../../../../../links/partner-payment-methods-link"
import { updatePaymentDetailsWorkflow } from "../../../../../../workflows/internal_payments/update-payment-details"
import { deletePaymentDetailsWorkflow } from "../../../../../../workflows/internal_payments/delete-payment-details"

// Verify the payment method belongs to the acting partner (prevents IDOR — a
// partner must not be able to edit/delete another partner's payout method).
async function verifyOwnership(req: AuthenticatedMedusaRequest) {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Partner not found")
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data: links } = await query.graph({
    entity: PartnerPaymentMethodsLink.entryPoint,
    fields: ["internal_payment_details_id"],
    filters: {
      partner_id: partner.id,
      internal_payment_details_id: req.params.methodId,
    },
  })

  if (!links?.length) {
    // NOT_FOUND rather than NOT_ALLOWED so a probing partner can't tell
    // "exists but not yours" from "no such thing".
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Payment method not found")
  }

  return partner
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await verifyOwnership(req)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data } = await query.graph({
    entity: PartnerPaymentMethodsLink.entryPoint,
    fields: ["internal_payment_details.*"],
    filters: {
      partner_id: partner.id,
      internal_payment_details_id: req.params.methodId,
    },
  })

  return res.status(200).json({
    paymentMethod: data?.[0]?.internal_payment_details || null,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await verifyOwnership(req)

  const { result } = await updatePaymentDetailsWorkflow(req.scope).run({
    input: {
      id: req.params.methodId,
      ...(req.validatedBody || {}),
    },
  })

  return res.status(200).json({ paymentMethod: result })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await verifyOwnership(req)
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any

  // Remove the partner link first, then soft-delete the method row.
  await remoteLink.dismiss({
    partner: { partner_id: partner.id },
    internal_payments: { internal_payment_details_id: req.params.methodId },
  })

  await deletePaymentDetailsWorkflow(req.scope).run({
    input: { id: req.params.methodId },
  })

  return res
    .status(200)
    .json({ id: req.params.methodId, object: "payment_method", deleted: true })
}
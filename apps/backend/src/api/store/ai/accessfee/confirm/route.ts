import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { AccessFeeConfirmReq } from "../validators"

export const POST = async (
  req: AuthenticatedMedusaRequest<AccessFeeConfirmReq>,
  res: MedusaResponse
) => {
  const customerId = req.auth_context?.actor_id
  const { session_id } = req.validatedBody

  const paymentService = req.scope.resolve(Modules.PAYMENT) as any

  // Retrieve the session to verify it belongs to this customer
  const [session] = await paymentService.listPaymentSessions({ id: [session_id] })

  if (!session) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Payment session not found")
  }

  if (session.metadata?.customer_id !== customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Payment session does not belong to this customer")
  }

  // authorizePaymentSession calls Stripe internally to verify the PaymentIntent succeeded
  const payment = await paymentService.authorizePaymentSession(session_id, {})

  if (!["authorized", "captured"].includes(payment?.status)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Payment not completed")
  }

  const customerService = req.scope.resolve(Modules.CUSTOMER) as any
  await customerService.updateCustomers(customerId, {
    metadata: {
      ai_features_paid: true,
      ai_payment_session_id: session_id,
    },
  })

  return res.json({ success: true })
}

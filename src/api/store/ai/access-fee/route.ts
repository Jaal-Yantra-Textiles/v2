import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const customerId = req.auth_context?.actor_id

  const customerService = req.scope.resolve(Modules.CUSTOMER) as any
  const [customer] = await customerService.listCustomers({ id: [customerId] })

  if (customer?.metadata?.ai_features_paid) {
    return res.json({ already_paid: true })
  }

  const paymentService = req.scope.resolve(Modules.PAYMENT) as any

  const collection = await paymentService.createPaymentCollections({
    currency_code: "eur",
    amount: 200,
  })

  const session = await paymentService.createPaymentSession(collection.id, {
    provider_id: "pp_stripe_stripe",
    currency_code: "eur",
    amount: 200,
    data: {},
    context: {
      customer: { id: customerId },
    },
    metadata: {
      customer_id: customerId,
      purpose: "ai_access_fee",
    },
  })

  return res.json({
    client_secret: session.data?.client_secret,
    session_id: session.id,
  })
}

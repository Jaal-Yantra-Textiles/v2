import { MedusaStoreRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createCustomerAccountWorkflow } from "@medusajs/medusa/core-flows"
import { getStoreFromPublishableKey } from "../helpers"

export const POST = async (
  req: MedusaStoreRequest,
  res: MedusaResponse
) => {
  if (req.auth_context?.actor_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Request already authenticated as a customer."
    )
  }

  const { result } = await createCustomerAccountWorkflow(req.scope).run({
    input: {
      customerData: req.validatedBody as any,
      authIdentityId: req.auth_context?.auth_identity_id!,
    },
  })

  // Auto-link customer to the store resolved from publishable key
  const store = await getStoreFromPublishableKey(
    req.publishable_key_context!,
    req.scope
  )

  if (store) {
    const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
    try {
      await remoteLink.create({
        [Modules.STORE]: { store_id: store.id },
        [Modules.CUSTOMER]: { customer_id: result.id },
      })
    } catch {
      // Link may already exist — ignore
    }
  }

  res.status(200).json({ customer: result })
}

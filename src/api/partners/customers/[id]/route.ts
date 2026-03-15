import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { deleteCustomersWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerStore, validatePartnerEntityOwnership } from "../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerEntityOwnership(
    req.auth_context,
    "customers",
    req.params.id,
    req.scope
  )

  const customerService = req.scope.resolve(Modules.CUSTOMER) as any
  const customer = await customerService.retrieveCustomer(req.params.id)

  res.json({ customer })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerEntityOwnership(
    req.auth_context,
    "customers",
    req.params.id,
    req.scope
  )

  const customerService = req.scope.resolve(Modules.CUSTOMER) as any
  const customer = await customerService.updateCustomers(req.params.id, req.body as any)

  res.json({ customer })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerEntityOwnership(
    req.auth_context,
    "customers",
    req.params.id,
    req.scope
  )

  // Remove link first
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.dismiss({
    [Modules.STORE]: { store_id: store.id },
    [Modules.CUSTOMER]: { customer_id: req.params.id },
  })

  await deleteCustomersWorkflow(req.scope).run({ input: { ids: [req.params.id] } })

  res.json({ id: req.params.id, object: "customer", deleted: true })
}

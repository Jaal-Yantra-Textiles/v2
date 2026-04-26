import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { deleteCustomerAddressesWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerEntityOwnership } from "../../../../helpers"

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
  const address = await customerService.retrieveCustomerAddress(req.params.addressId)

  res.json({ address })
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
  const address = await customerService.updateCustomerAddresses(
    req.params.addressId,
    req.body as any
  )

  res.json({ address })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerEntityOwnership(
    req.auth_context,
    "customers",
    req.params.id,
    req.scope
  )

  await deleteCustomerAddressesWorkflow(req.scope).run({ input: { ids: [req.params.addressId] } })

  res.json({ id: req.params.addressId, object: "customer_address", deleted: true })
}

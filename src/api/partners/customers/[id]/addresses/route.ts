import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { validatePartnerEntityOwnership } from "../../../helpers"

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
  const addresses = await customerService.listCustomerAddresses({
    customer_id: req.params.id,
  })

  res.json({ addresses, count: addresses.length })
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
  const address = await customerService.createCustomerAddresses({
    ...(req.body as any),
    customer_id: req.params.id,
  })

  res.status(201).json({ address })
}

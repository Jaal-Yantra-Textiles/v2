import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { getPartnerStore } from "../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await getPartnerStore(req.auth_context, req.scope)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "stores",
    fields: ["customers.*"],
    filters: { id: store.id },
  })

  const customers = (data?.[0] as any)?.customers || []

  res.json({
    customers,
    count: customers.length,
    offset: 0,
    limit: 20,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await getPartnerStore(req.auth_context, req.scope)

  const customerService = req.scope.resolve(Modules.CUSTOMER) as any
  const customer = await customerService.createCustomers(req.body as any)

  // Link customer to store
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.create({
    [Modules.STORE]: { store_id: store.id },
    [Modules.CUSTOMER]: { customer_id: customer.id },
  })

  res.status(201).json({ customer })
}

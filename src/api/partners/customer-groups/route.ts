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
    fields: ["customer_groups.*"],
    filters: { id: store.id },
  })

  const customer_groups = (data?.[0] as any)?.customer_groups || []

  res.json({
    customer_groups,
    count: customer_groups.length,
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
  const customer_group = await customerService.createCustomerGroups(req.body as any)

  // Link customer group to store
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.create({
    [Modules.STORE]: { store_id: store.id },
    [Modules.CUSTOMER]: { customer_group_id: customer_group.id },
  })

  res.status(201).json({ customer_group })
}

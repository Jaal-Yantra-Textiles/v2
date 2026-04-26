import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { deleteCustomerGroupsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerEntityOwnership } from "../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerEntityOwnership(
    req.auth_context,
    "customer_groups",
    req.params.id,
    req.scope
  )

  const customerService = req.scope.resolve(Modules.CUSTOMER) as any
  const customer_group = await customerService.retrieveCustomerGroup(req.params.id)

  res.json({ customer_group })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerEntityOwnership(
    req.auth_context,
    "customer_groups",
    req.params.id,
    req.scope
  )

  const customerService = req.scope.resolve(Modules.CUSTOMER) as any
  const customer_group = await customerService.updateCustomerGroups(
    req.params.id,
    req.body as any
  )

  res.json({ customer_group })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerEntityOwnership(
    req.auth_context,
    "customer_groups",
    req.params.id,
    req.scope
  )

  // Remove link first
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.dismiss({
    [Modules.STORE]: { store_id: store.id },
    [Modules.CUSTOMER]: { customer_group_id: req.params.id },
  })

  await deleteCustomerGroupsWorkflow(req.scope).run({ input: { ids: [req.params.id] } })

  res.json({ id: req.params.id, object: "customer_group", deleted: true })
}

import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { linkCustomerGroupsToCustomerWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerEntityOwnership } from "../../../helpers"

// Mirror admin POST /admin/customers/:id/customer-groups: the
// customer <-> customer_group relationship is internal to the CUSTOMER module
// (addCustomerToGroup/removeCustomerFromGroup), NOT a registered module link.
// The previous remoteLink.create/dismiss between "customer" and "customer_group"
// 500'd because no such link is defined. Use the core workflow instead (#495).
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

  const body = req.body as { add?: string[]; remove?: string[] }

  await linkCustomerGroupsToCustomerWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      add: body.add ?? [],
      remove: body.remove ?? [],
    },
  })

  const customerService = req.scope.resolve(Modules.CUSTOMER) as any
  const customer = await customerService.retrieveCustomer(req.params.id, {
    relations: ["groups"],
  })

  res.json({ customer })
}

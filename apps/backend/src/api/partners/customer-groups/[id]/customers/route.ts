import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { linkCustomersToCustomerGroupWorkflow } from "@medusajs/medusa/core-flows"
import {
  validatePartnerEntityOwnership,
  validatePartnerOwnsEntities,
} from "../../../helpers"

/**
 * Manage the customers of one of the partner's customer groups.
 *
 * Two things were wrong here, and they were wrong in different ways.
 *
 * 🔴 **Only the group was validated.** `body.add` was an unchecked array of
 * arbitrary customer ids, so a partner could pull ANOTHER partner's customers
 * into their own group — and `body.remove` could dismiss links they did not
 * own. Owning the resource in the URL says nothing about owning the ids in the
 * body, so both ends are checked now.
 *
 * ⚠️ **It wrote a link that does not exist.** The customer ↔ customer_group
 * relationship is internal to the CUSTOMER module, not a registered module
 * link, so `remoteLink.create({ customer_group, customer })` threw — the same
 * bug the sibling route `customers/:id/customer-groups` documents fixing in
 * #495. That fix never reached this file, which is why the security hole was
 * academic: the route could not succeed. It can now, so the guard has to be
 * real.
 */
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

  const body = req.body as { add?: string[]; remove?: string[] }
  const add = body.add ?? []
  const remove = body.remove ?? []

  // Both ends. Every customer named in the body must be one of ours.
  await validatePartnerOwnsEntities(
    req.auth_context,
    "customers",
    [...add, ...remove],
    req.scope
  )

  await linkCustomersToCustomerGroupWorkflow(req.scope).run({
    input: { id: req.params.id, add, remove },
  })

  const customerService = req.scope.resolve(Modules.CUSTOMER) as any
  const customer_group = await customerService.retrieveCustomerGroup(
    req.params.id,
    { relations: ["customers"] }
  )

  res.json({ customer_group })
}

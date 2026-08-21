import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  deletePriceListsWorkflow,
  updatePriceListsWorkflow,
} from "@medusajs/medusa/core-flows"
import { validatePartnerEntityOwnership } from "../../helpers"
import { validatePriceListRules } from "../helpers"

/**
 * `validatePartnerEntityOwnership` is the FIRST statement of every handler
 * here — it resolves the partner's store and asserts the id in the URL is
 * linked to it, throwing NOT_FOUND (never NOT_ALLOWED) so a partner probing
 * ids cannot tell "exists but not yours" from "no such thing".
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerEntityOwnership(
    req.auth_context,
    "price_lists",
    req.params.id,
    req.scope
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "price_lists",
    fields: ["*", "prices.*", "price_list_rules.*"],
    filters: { id: req.params.id },
  })

  res.json({ price_list: data?.[0] })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerEntityOwnership(
    req.auth_context,
    "price_lists",
    req.params.id,
    req.scope
  )

  const body = req.validatedBody as any
  // Owning the list says nothing about owning the groups an update re-scopes it
  // to — an update can move a list onto another partner's customer group just
  // as easily as a create can.
  await validatePriceListRules(req.auth_context, body?.rules, req.scope)

  const { result } = await updatePriceListsWorkflow(req.scope).run({
    input: { price_lists_data: [{ ...body, id: req.params.id }] },
  })

  res.json({ price_list: (result as any[])[0] })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerEntityOwnership(
    req.auth_context,
    "price_lists",
    req.params.id,
    req.scope
  )

  // Dismiss the link BEFORE the delete, so the dangling state that took every
  // storefront down (a surviving row pointing at a deleted entity) is never
  // written, even for an instant.
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.dismiss({
    [Modules.STORE]: { store_id: store.id },
    [Modules.PRICING]: { price_list_id: req.params.id },
  })

  await deletePriceListsWorkflow(req.scope).run({
    input: { ids: [req.params.id] },
  })

  res.json({ id: req.params.id, object: "price_list", deleted: true })
}

import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createPriceListsWorkflow, deletePriceListsWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerStore, tryGetPartnerStore } from "../helpers"
import { validatePriceListRules } from "./helpers"

/**
 * Price lists are global in core. Everything here reads and writes through the
 * `store ↔ price_list` link (`src/links/store-price-list.ts`) so a partner only
 * ever sees their own — the same shape as `../customer-groups/`, but with a
 * body validator, which that surface lacks.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await tryGetPartnerStore(req.auth_context, req.scope)
  if (!store) {
    return res.json({ price_lists: [], count: 0, offset: 0, limit: 20 })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "stores",
    fields: ["price_lists.*", "price_lists.prices.*", "price_lists.price_list_rules.*"],
    filters: { id: store.id },
  })

  const price_lists = (data?.[0] as any)?.price_lists || []

  res.json({
    price_lists,
    count: price_lists.length,
    offset: 0,
    limit: 20,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await getPartnerStore(req.auth_context, req.scope)

  const body = req.validatedBody as any
  await validatePriceListRules(req.auth_context, body?.rules, req.scope)

  const { result } = await createPriceListsWorkflow(req.scope).run({
    input: { price_lists_data: [body] },
  })

  const price_list = (result as any[])[0]

  // Link the price list to the store — without this the list is invisible to
  // every guard and every list read, i.e. it exists but belongs to no one.
  //
  // ⚠️ An unlinked price list is not merely invisible: `rules_count = 0` makes
  // core apply it to EVERY customer on the platform, and no partner surface can
  // then see it to delete it. So the create is rolled back if the link fails —
  // a half-written tenant boundary is worse than no write at all.
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  try {
    await remoteLink.create({
      [Modules.STORE]: { store_id: store.id },
      [Modules.PRICING]: { price_list_id: price_list.id },
    })
  } catch (e) {
    await deletePriceListsWorkflow(req.scope).run({
      input: { ids: [price_list.id] },
    })
    throw e
  }

  res.status(201).json({ price_list })
}

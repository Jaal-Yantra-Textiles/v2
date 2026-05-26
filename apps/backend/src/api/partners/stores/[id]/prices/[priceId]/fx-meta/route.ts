import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { FX_RATES_MODULE } from "../../../../../../../modules/fx_rates"
import type FxRatesService from "../../../../../../../modules/fx_rates/service"
import { validatePartnerStoreAccess } from "../../../../../helpers"

/**
 * Detach the FX-auto marker from a price.
 *
 * Called by the partner UI when the partner edits a previously
 * auto-converted cell to a new value — the price stops being
 * "owned" by the fanout system and becomes a manual price (immune
 * to G5's daily re-rate). Re-running the fanout subscriber on an
 * unrelated price won't re-create the marker on this price either,
 * because the source-price logic only creates markers for prices
 * it itself just added.
 *
 * Scoping: walk price_id → price_set → variant → product →
 * sales_channels → store. If none of those stores match the
 * partner's store, 404. Same chain the fanout workflow uses (kept
 * read-only so the chain is cheap).
 *
 * Idempotent. If there's no fx_price_meta link, returns
 * `{ deleted: false }`.
 */
export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const priceId = req.params.priceId
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const fxService = req.scope.resolve(FX_RATES_MODULE) as FxRatesService

  // Resolve the price → price_set → variant → product → sales_channel → store.
  // If the chain doesn't terminate at this partner's store, treat as NOT_FOUND.
  const { data: prices } = await query.graph({
    entity: "price",
    filters: { id: priceId },
    fields: ["id", "price_set_id", "fx_price_meta.id"],
  })
  const price = prices?.[0] as any
  if (!price) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `price ${priceId} not found`)
  }

  const { data: variantLinks } = await query.graph({
    entity: "product_variant_price_set",
    filters: { price_set_id: price.price_set_id },
    fields: ["variant.product.sales_channels.store_id"],
  })
  const storeIds: string[] = []
  for (const vl of variantLinks ?? []) {
    for (const sc of (vl as any).variant?.product?.sales_channels ?? []) {
      if (sc?.store_id) storeIds.push(sc.store_id)
    }
  }
  if (!storeIds.includes(store.id)) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `price ${priceId} does not belong to this partner's store`
    )
  }

  if (!price.fx_price_meta?.id) {
    return res.json({ id: priceId, deleted: false })
  }

  const fxMetaId: string = price.fx_price_meta.id
  await link.dismiss([
    {
      [Modules.PRICING]: { price_id: priceId },
      [FX_RATES_MODULE]: { fx_price_meta_id: fxMetaId },
    },
  ])
  await fxService.deleteFxPriceMetas(fxMetaId)

  res.json({ id: priceId, deleted: true })
}

/**
 * POST /partners/stores/:id/products/:productId/variants/inventory-items/batch
 *
 * Edit an existing variant's inventory kit: add a stock item, change how many
 * of it one unit uses (`required_quantity` — a "12 m pack" is 12 of a per-metre
 * item), or remove it. Partner mirror of core's
 * `/admin/products/:id/variants/inventory-items/batch`.
 *
 * partner-ui's "Manage inventory items" form has always POSTed here, and the
 * route did not exist: every kit edit after create was a 404.
 *
 * Body: { create?: [{ variant_id, inventory_item_id, required_quantity }],
 *         update?: [{ variant_id, inventory_item_id, required_quantity }],
 *         delete?: [{ variant_id, inventory_item_id }] }
 *
 * 🔴 Ownership is checked on all three ids, not just the store in the path:
 *  · the product must be in the store's sales channel,
 *  · every variant must belong to that product,
 *  · every inventory item must be stocked at one of the store's locations.
 * Otherwise a partner could tie their variant to another partner's stock, and
 * sell it down.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { batchLinksWorkflow } from "@medusajs/medusa/core-flows"
import { buildBatchVariantInventoryData } from "@medusajs/medusa/api/admin/products/helpers"
import { partnerStoreLocationIds, validatePartnerStoreAccess } from "../../../../../../../helpers"
import { PartnerBatchVariantInventoryItems } from "./validators"
import { findKitBatchOwnershipProblem } from "./ownership"

export const POST = async (
  req: AuthenticatedMedusaRequest<PartnerBatchVariantInventoryItems>,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(req.auth_context, req.params.id, req.scope)
  const { create = [], update = [], delete: toDelete = [] } = req.validatedBody
  const rows = [...create, ...update, ...toDelete]

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "variants.id", "sales_channels.id"],
    filters: { id: req.params.productId },
  })
  const product = products?.[0] as any

  const itemIds = [...new Set(rows.map((r) => r.inventory_item_id))]
  const { data: items } = itemIds.length
    ? await query.graph({
        entity: "inventory_item",
        fields: ["id", "location_levels.location_id"],
        filters: { id: itemIds },
      })
    : { data: [] as any[] }

  const problem = findKitBatchOwnershipProblem({
    product: product
      ? {
          variantIds: (product.variants || []).map((v: any) => v.id),
          salesChannelIds: (product.sales_channels || []).map((s: any) => s.id),
        }
      : null,
    storeSalesChannelId: store.default_sales_channel_id,
    storeLocationIds: [...(await partnerStoreLocationIds(store, req.scope))],
    items: (items as any[]).map((i) => ({
      id: i.id,
      locationIds: (i.location_levels || []).map((l: any) => l.location_id),
    })),
    rows,
  })
  if (problem) {
    // NOT_FOUND, not UNAUTHORIZED: the answer must not confirm that an id
    // exists in someone else's store.
    throw new MedusaError(MedusaError.Types.NOT_FOUND, problem)
  }

  const { result } = await batchLinksWorkflow(req.scope).run({
    input: {
      create: buildBatchVariantInventoryData(create),
      update: buildBatchVariantInventoryData(update),
      delete: buildBatchVariantInventoryData(toDelete),
    },
  })

  res.status(200).json({
    created: result.created,
    updated: result.updated,
    deleted: result.deleted,
  })
}

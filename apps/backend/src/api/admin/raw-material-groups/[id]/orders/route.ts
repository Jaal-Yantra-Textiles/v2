/**
 * API: /admin/raw-material-groups/:id/orders  (#817 S3)
 *
 * POST — order a group in multiple colors. Fans out one inventory-order line
 *        per selected color, resolving (or auto-creating) each color's
 *        inventory_item first, then delegating to createInventoryOrderWorkflow
 *        (which denormalizes color identity onto each line per S2).
 *
 * Note: item resolution and order creation are two workflow runs, not one
 * transaction. If order creation fails, any auto-created inventory_items are
 * rolled back by the resolve workflow's compensation; a successful resolve
 * followed by a failed create leaves the (reusable) items in place.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createInventoryOrderWorkflow } from "../../../../../workflows/inventory_orders/create-inventory-orders"
import { resolveGroupColorInventoryItemsWorkflow } from "../../../../../workflows/raw_material_groups/resolve-group-color-items"
import { RAW_MATERIAL_MODULE } from "../../../../../modules/raw_material"
import {
  sumGroupOrderTotal,
  sumGroupOrderQuantity,
} from "../../../../../modules/raw_material/lib/group-order-helpers"
import { refetchInventoryOrder } from "../../../inventory-orders/helpers"
import { CreateGroupOrder } from "../../validators"

/**
 * GET — list the inventory-order lines that belong to this group's colors,
 * each with its parent order. Powers the group detail "Orders" section so a
 * color's order history reads back without re-traversing links (S2 denorm).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: groupId } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const service: any = req.scope.resolve(RAW_MATERIAL_MODULE)
  const group = await service.retrieveRawMaterialGroup(groupId).catch(() => null)
  if (!group) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Raw material group with id "${groupId}" not found`
    )
  }

  const { data: colors } = await query.graph({
    entity: "raw_materials",
    fields: ["id"],
    filters: { group_id: groupId },
  })
  const rawMaterialIds = (colors as any[]).map((c) => c.id).filter(Boolean)

  if (!rawMaterialIds.length) {
    return res.json({ order_lines: [] })
  }

  const { data: lines } = await query.graph({
    entity: "inventory_order_line",
    fields: [
      "id",
      "quantity",
      "price",
      "color",
      "material_name",
      "raw_material_id",
      "inventory_orders.id",
      "inventory_orders.status",
      "inventory_orders.order_date",
      "inventory_orders.expected_delivery_date",
    ],
    filters: { raw_material_id: rawMaterialIds },
  })

  res.json({ order_lines: lines ?? [] })
}

export const POST = async (
  req: MedusaRequest<CreateGroupOrder>,
  res: MedusaResponse
) => {
  const { id: groupId } = req.params
  const body = req.validatedBody
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  // Group must exist.
  const service: any = req.scope.resolve(RAW_MATERIAL_MODULE)
  const group = await service.retrieveRawMaterialGroup(groupId).catch(() => null)
  if (!group) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Raw material group with id "${groupId}" not found`
    )
  }

  // 1) Resolve / auto-create the inventory_item for each selected color.
  const { result: resolved, errors: resolveErrors } =
    await resolveGroupColorInventoryItemsWorkflow(req.scope).run({
      input: {
        lines: body.lines,
        stock_location_id: body.stock_location_id,
      },
    })
  if (resolveErrors?.length) {
    logger.warn(`[group-order] resolve failed: ${JSON.stringify(resolveErrors)}`)
    throw resolveErrors
  }

  // 2) Create the inventory order from the fanned-out lines.
  const { result, errors } = await createInventoryOrderWorkflow(req.scope).run({
    input: {
      order_lines: resolved.order_lines,
      quantity: sumGroupOrderQuantity(body.lines),
      total_price: sumGroupOrderTotal(body.lines),
      currency_code: body.currency_code,
      status: body.status,
      order_date: body.order_date,
      expected_delivery_date: body.expected_delivery_date,
      shipping_address: body.shipping_address,
      stock_location_id: body.stock_location_id,
      from_stock_location_id: body.from_stock_location_id,
      to_stock_location_id: body.to_stock_location_id,
      is_sample: body.is_sample,
      metadata: { ...(body.metadata ?? {}), raw_material_group_id: groupId },
    } as any,
  })
  if (errors?.length) {
    logger.warn(`[group-order] create failed: ${JSON.stringify(errors)}`)
    throw errors
  }

  const inventoryOrder = await refetchInventoryOrder(result.order.id, req.scope)
  res.status(201).json({
    inventoryOrder,
    created_inventory_item_ids: resolved.created_inventory_item_ids,
  })
}

/**
 * @route /admin/inventory-transfers
 * @scope admin
 *
 * #2144 — material we already own, moving between two locations.
 *
 * 🔴 Deliberately NOT under `/admin/production-runs/:id/transfers`. That path
 * scopes a transfer to the run that produced the goods, and material has no
 * run: nothing was produced, so there is no approval to gate the posting and
 * no variant to derive the item from. Hanging material off a run id would have
 * meant inventing one.
 *
 *   POST /admin/inventory-transfers  — record an onward hop
 *   GET  /admin/inventory-transfers  — the material hops recorded so far
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { FULLFILLED_ORDERS_MODULE } from "../../../modules/fullfilled_orders"
import { createMaterialTransfer } from "../../../workflows/inventory-transfers/material-transfer"
import { createMaterialTransferSchema } from "./validators"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const parsed = createMaterialTransferSchema.safeParse(
    (req as any).validatedBody ?? req.body ?? {}
  )
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid body: ${parsed.error.issues.map((i) => i.message).join(", ")}`
    )
  }
  const body = parsed.data

  const transfer = await createMaterialTransfer(req.scope, {
    inventoryItemId: body.inventory_item_id,
    fromLocationId: body.from_location_id,
    toLocationId: body.to_location_id,
    quantity: body.quantity,
    reason: body.reason,
    sourceInventoryOrderId: body.source_inventory_order_id ?? null,
    notes: body.notes ?? null,
    actingUserId: (req as any).auth_context?.actor_id ?? null,
  })

  res.status(200).json({ material_transfer: transfer })
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const service: any = req.scope.resolve(FULLFILLED_ORDERS_MODULE)
  const q = req.query as Record<string, string | undefined>

  const filters: Record<string, any> = {}
  if (q.inventory_item_id) filters.inventory_item_id = q.inventory_item_id
  if (q.from_location_id) filters.from_location_id = q.from_location_id
  if (q.to_location_id) filters.to_location_id = q.to_location_id
  if (q.status) filters.status = q.status

  const [rows, count] = await service.listAndCountGoodsTransfers(filters, {
    take: Number(q.limit ?? 50),
    skip: Number(q.offset ?? 0),
    order: { created_at: "DESC" },
  })

  /**
   * 🔴 Material rows only. The same table holds run output, and returning both
   * from a route called "inventory transfers" would put garments in a list an
   * operator reads as cloth. Filtered here rather than in the query because the
   * discriminator is "has an inventory_item_id and no run", which is a rule,
   * not a column.
   */
  const material = (rows || []).filter(
    (r: any) => r?.inventory_item_id && !r?.production_run_id
  )

  res.status(200).json({
    material_transfers: material,
    count: material.length,
    total_rows_scanned: count,
    offset: Number(q.offset ?? 0),
    limit: Number(q.limit ?? 50),
  })
}

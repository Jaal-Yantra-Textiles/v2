/**
 * GET /admin/inventory-orders/:id/activities
 *
 * Returns the inventory order's activity/timeline log (#778 H4), newest first.
 * Supports `limit` (default 50, max 100) and `offset` pagination.
 *
 * Response: { activities: InventoryOrderActivity[], count, limit, offset }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ORDER_INVENTORY_MODULE } from "../../../../../modules/inventory_orders";
import type InventoryOrderService from "../../../../../modules/inventory_orders/service";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const service: InventoryOrderService = req.scope.resolve(ORDER_INVENTORY_MODULE);

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const [activities, count] = await service.listAndCountInventoryOrderActivities(
    { inventory_order_id: id },
    { order: { occurred_at: "DESC" }, take: limit, skip: offset }
  );

  res.status(200).json({ activities, count, limit, offset });
};

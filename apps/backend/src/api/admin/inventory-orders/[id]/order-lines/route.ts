
/**
 * PUT /admin/inventory-orders/:id/order-lines
 *
 * Updates an inventory order's metadata and its order lines.
 *
 * This route handler runs the `updateInventoryOrderWorkflow` with the provided
 * request scope and payload, then refetches the updated inventory order and
 * returns it in the response.
 *
 * Request:
 * - Path parameter:
 *   - id: string — the inventory order id to update
 * - Body (JSON): see updateInventoryOrderLinesSchema (validators.ts)
 *   - data?: { quantity?: number; total_price?: number } — optional order totals
 *   - order_lines: Array<{ id?: string; inventory_item_id: string; quantity: number; price: number }>
 *     The full desired set of lines (existing lines carry `id`; new lines omit it).
 *
 * Response:
 * - 200: { inventoryOrder: object } — the refreshed inventory order after the update
 *
 * Errors:
 * - Throws the workflow errors if the update workflow returns any errors.
 *
 * @param req - MedusaRequest; req.params.id is required, body must contain `order_lines` (and optional `data`)
 * @param res - MedusaResponse; used to return the updated inventoryOrder
 *
 * @example Curl
 * curl -X PUT "https://example.com/admin/inventory-orders/inv_order_123/order-lines" \
 *   -H "Content-Type: application/json" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *   -d '{
 *     "data": { "quantity": 15, "total_price": 120 },
 *     "order_lines": [
 *       { "id": "ol_1", "inventory_item_id": "iitem_A", "quantity": 10, "price": 8 },
 *       { "inventory_item_id": "iitem_B", "quantity": 5, "price": 8 }
 *     ]
 *   }'
 *
 * @example Fetch (Node / Browser)
 * const res = await fetch("/admin/inventory-orders/inv_order_123/order-lines", {
 *   method: "PUT",
 *   headers: {
 *     "Content-Type": "application/json",
 *     "Authorization": "Bearer <ADMIN_TOKEN>"
 *   },
 *   body: JSON.stringify({
 *     data: { quantity: 5 },
 *     order_lines: [{ id: "ol_1", inventory_item_id: "iitem_A", quantity: 5, price: 8 }]
 *   })
 * });
 * const { inventoryOrder } = await res.json();
 *
 * @example Success response
 * HTTP/1.1 200 OK
 * Content-Type: application/json
 *
 * {
 *   "inventoryOrder": {
 *     "id": "ord_123",
 *     "status": "received",
 *     "order_lines": [
 *       { "id": "ol_1", "quantity": 5, /* ... *\/ },
 *       { "id": "ol_2", "quantity": 0, /* ... *\/ }
 *     ],
 *     /* ...other inventory order properties... *\/
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { updateInventoryOrderWorkflow } from "../../../../../workflows/inventory_orders/update-inventory-orders";
import { refetchInventoryOrder } from "../../helpers";
import type { UpdateInventoryOrderLines } from "../../validators";

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params;
  // #778 H10 — use the validated/transformed body (a validator is registered
  // for this route in middlewares.ts), not the raw req.body.
  const payload = req.validatedBody as UpdateInventoryOrderLines;

  const { result, errors } = await updateInventoryOrderWorkflow(req.scope).run({
    input: {
      id,
      data: payload.data || {},
      order_lines: payload.order_lines || [],
    },
  });

  if (errors.length > 0) {
    // Throw the underlying MedusaError so it maps to the right 4xx, not the
    // raw errors array.
    throw errors[0].error;
  }

  const inventoryOrder = await refetchInventoryOrder(id, req.scope);

  res.status(200).json({ inventoryOrder });
};

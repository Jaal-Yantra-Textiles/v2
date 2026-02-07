
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
 * - Body (JSON):
 *   - data?: Record<string, any> — optional top-level metadata/attributes to update
 *   - order_lines?: Array<any> — optional array of order line updates
 *
 * Response:
 * - 200: { inventoryOrder: object } — the refreshed inventory order after the update
 *
 * Errors:
 * - Throws the workflow errors if the update workflow returns any errors.
 *
 * @param req - MedusaRequest; req.params.id is required, body should contain `data` and/or `order_lines`
 * @param res - MedusaResponse; used to return the updated inventoryOrder
 *
 * @example Curl
 * curl -X PUT "https://example.com/admin/inventory-orders/ord_123/order-lines" \
 *   -H "Content-Type: application/json" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *   -d '{
 *     "data": { "status": "received", "notes": "Updated via API" },
 *     "order_lines": [
 *       { "id": "ol_1", "quantity": 10 },
 *       { "id": "ol_2", "quantity": 0, "action": "remove" }
 *     ]
 *   }'
 *
 * @example Fetch (Node / Browser)
 * const res = await fetch("/admin/inventory-orders/ord_123/order-lines", {
 *   method: "PUT",
 *   headers: {
 *     "Content-Type": "application/json",
 *     "Authorization": "Bearer <ADMIN_TOKEN>"
 *   },
 *   body: JSON.stringify({
 *     data: { status: "received" },
 *     order_lines: [{ id: "ol_1", quantity: 5 }]
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

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params;
  const payload = req.body as any;

  const { result, errors } = await updateInventoryOrderWorkflow(req.scope).run({
    input: {
      id,
      data: payload.data || {},
      order_lines: payload.order_lines || [],
    },
  });

  if (errors.length > 0) {
    throw errors;
  }

  const inventoryOrder = await refetchInventoryOrder(id, req.scope);

  res.status(200).json({ inventoryOrder });
};

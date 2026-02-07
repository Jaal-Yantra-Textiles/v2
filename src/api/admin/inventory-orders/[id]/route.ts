/**
 * @route /admin/inventory-orders/:id
 * @scope admin
 *
 * Description:
 *  Manage a single inventory order by id.
 *
 * Methods:
 *
 *  PUT /admin/inventory-orders/:id
 *    - Updates an inventory order.
 *    - Request body: UpdateInventoryOrder (see validators)
 *    - Notes: order_lines are passed separately in the workflow input.
 *    - Success: 200 -> returns the refreshed inventory order object.
 *    - Error: 400 -> { errors: [...] }
 *
 *    Example (curl):
 *      curl -X PUT "https://api.example.com/admin/inventory-orders/io_123" \
 *        -H "Content-Type: application/json" \
 *        -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *        -d '{
 *          "status": "confirmed",
 *          "metadata": { "source": "manual" },
 *          "order_lines": [
 *            { "sku": "sku_abc", "quantity": 10 },
 *            { "sku": "sku_xyz", "quantity": 5 }
 *          ]
 *        }'
 *
 *    Example success response (200):
 *      {
 *        "id": "io_123",
 *        "status": "confirmed",
 *        "metadata": { "source": "manual" },
 *        "order_lines": [
 *          { "id": "line_1", "sku": "sku_abc", "quantity": 10 },
 *          { "id": "line_2", "sku": "sku_xyz", "quantity": 5 }
 *        ],
 *        "created_at": "2024-01-01T12:00:00Z",
 *        "updated_at": "2024-01-02T09:00:00Z"
 *      }
 *
 *  GET /admin/inventory-orders/:id
 *    - Returns a single inventory order.
 *    - Accepts queryConfig options (pagination/relations) via req.queryConfig.
 *    - Success: 200 -> { inventoryOrder: { ... } }
 *
 *    Example (curl):
 *      curl "https://api.example.com/admin/inventory-orders/io_123" \
 *        -H "Authorization: Bearer <ADMIN_TOKEN>"
 *
 *    Example success response (200):
 *      {
 *        "inventoryOrder": {
 *          "id": "io_123",
 *          "status": "draft",
 *          "order_lines": [
 *            { "id": "line_1", "sku": "sku_abc", "quantity": 10 }
 *          ],
 *          "created_at": "2024-01-01T12:00:00Z"
 *        }
 *      }
 *
 *  DELETE /admin/inventory-orders/:id
 *    - Deletes an inventory order.
 *    - Success: 200 -> {}
 *    - Error: 400 -> { errors: [...] }
 *
 *    Example (curl):
 *      curl -X DELETE "https://api.example.com/admin/inventory-orders/io_123" \
 *        -H "Authorization: Bearer <ADMIN_TOKEN>"
 *
 *    Example success response (200):
 *      {}
 *
 * Notes:
 *  - All endpoints require admin authentication (Bearer token).
 *  - Errors returned from workflows are forwarded as 400 with an `errors` array.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { UpdateInventoryOrder } from "../validators";
import { refetchInventoryOrder } from "../helpers";
import updateInventoryOrderWorkflow from "../../../../workflows/inventory_orders/update-inventory-orders";
import { ListInventoryOrdersStepInput } from "../../../../workflows/inventory_orders/list-inventory-orders";
import listSingleInventoryOrderWorkflow from "../../../../workflows/inventory_orders/list-single-inventory-order";
import { deleteInventoryOrderWorkflow } from "../../../../workflows/inventory_orders/delete-inventory-order";

export const PUT = async (
  req: MedusaRequest<UpdateInventoryOrder>,
  res: MedusaResponse
) => {
  const validatedBody = req.validatedBody;
  const id = req.params.id;

  // Prepare workflow input
  const input = {
    id,
    data: { ...validatedBody, order_lines: undefined }, // all fields except order_lines
    order_lines: validatedBody.order_lines || [],
  };

  const { errors } = await updateInventoryOrderWorkflow(req.scope).run({ input });
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }
  const inventoryOrder = await refetchInventoryOrder(id, req.scope);
  return res.status(200).json(inventoryOrder);
};


export const GET = async(
  req: MedusaRequest<ListInventoryOrdersStepInput>,
  res: MedusaResponse
  ) => {
    const id = req.params.id;
    const { result: inventoryOrder } = await listSingleInventoryOrderWorkflow(req.scope).run({
      input: {
        id,
        ...req.queryConfig
      },
    });
    res.status(200).json({ inventoryOrder });
  }


  export const DELETE = async(
    req: MedusaRequest<{ id: string }>,
    res: MedusaResponse
  ) => {
    const id = req.params.id;
    const { errors } = await deleteInventoryOrderWorkflow(req.scope).run({
      input: {
        id,
      },
    });
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }
    res.status(200).json({});
  }
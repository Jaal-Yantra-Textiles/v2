/**
 * API: /admin/inventory-orders
 *
 * POST /admin/inventory-orders
 * - Description: Create a new inventory order via the createInventoryOrderWorkflow.
 * - Permissions: Admin
 * - Request Body (application/json): CreateInventoryOrder
 *   Example:
 *   {
 *     "supplier_id": "sup_123",
 *     "items": [
 *       { "sku": "FABRIC_A", "quantity": 200, "unit_price": 4.5 },
 *       { "sku": "TRIM_B", "quantity": 50, "unit_price": 1.25 }
 *     ],
 *     "expected_delivery_date": "2026-02-15T00:00:00.000Z",
 *     "notes": "Urgent run for spring collection"
 *   }
 * - Success (201):
 *   Content-Type: application/json
 *   Example:
 *   {
 *     "inventoryOrder": {
 *       "id": "invord_abc123",
 *       "supplier_id": "sup_123",
 *       "status": "pending",
 *       "items": [
 *         { "sku": "FABRIC_A", "quantity": 200, "unit_price": 4.5 },
 *         { "sku": "TRIM_B", "quantity": 50, "unit_price": 1.25 }
 *       ],
 *       "total_price": 1000.0,
 *       "expected_delivery_date": "2026-02-15T00:00:00.000Z",
 *       "created_at": "2026-01-14T12:00:00.000Z"
 *     }
 *   }
 * - Errors:
 *   - 400 / INVALID_DATA: validation errors from validators
 *   - 409 / CONFLICT: business constraints
 *
 * Example curl:
 * curl -X POST "https://api.example.com/admin/inventory-orders" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *   -H "Content-Type: application/json" \
 *   -d '{ "supplier_id":"sup_123", "items":[{"sku":"FABRIC_A","quantity":200,"unit_price":4.5}], "expected_delivery_date":"2026-02-15T00:00:00.000Z" }'
 *
 * --------------------------------------------------------------------------
 *
 * GET /admin/inventory-orders
 * - Description: List inventory orders using filters, pagination and ordering. Uses listInventoryOrdersWorkflow.
 * - Permissions: Admin
 * - Query Parameters (see listInventoryOrdersQuerySchema):
 *   - q (string)         : text search / id
 *   - status (string)    : one of InventoryOrderStatus (e.g. pending, received, cancelled)
 *   - quantity (number)  : exact quantity filter
 *   - total_price (number): exact total price filter
 *   - expected_delivery_date (ISO date)
 *   - order_date (ISO date)
 *   - order (string)     : "created_at:desc" or "total_price:asc" (parsed by parseOrderParam)
 *   - offset (number)    : pagination offset (default 0)
 *   - limit (number)     : pagination limit (default 50)
 * - Success (200):
 *   Content-Type: application/json
 *   Example:
 *   {
 *     "inventory_orders": [
 *       {
 *         "id": "invord_abc123",
 *         "supplier_id": "sup_123",
 *         "status": "pending",
 *         "items": [ { "sku":"FABRIC_A", "quantity":200, "unit_price":4.5 } ],
 *         "total_price": 900.0,
 *         "expected_delivery_date": "2026-02-15T00:00:00.000Z",
 *         "created_at": "2026-01-12T10:00:00.000Z"
 *       }
 *     ],
 *     "count": 1,
 *     "offset": 0,
 *     "limit": 50
 *   }
 * - Errors:
 *   - 400 / INVALID_DATA: invalid query values
 *
 * Example curl:
 * curl -X GET "https://api.example.com/admin/inventory-orders?status=pending&limit=20&order=created_at:desc" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>"
 */
import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { createInventoryOrderWorkflow } from "../../../workflows/inventory_orders/create-inventory-orders";
import { CreateInventoryOrder, ListInventoryOrdersQuery, listInventoryOrdersQuerySchema } from "./validators";
import { parseOrderParam, refetchInventoryOrder } from "./helpers";
import { listInventoryOrdersWorkflow } from "../../../workflows/inventory_orders/list-inventory-orders";
import { InventoryOrderStatus } from "../../../modules/inventory_orders/constants";

export const POST = async (
  req: MedusaRequest<CreateInventoryOrder>,
  res: MedusaResponse,
) => {
  const { result, errors } = await createInventoryOrderWorkflow(req.scope).run({
    input: {
     ...req.validatedBody
    },
  });

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  const inventoryOrder = await refetchInventoryOrder(
    result.order.id,
    req.scope,
  );

  res.status(201).json( { inventoryOrder } );
};

export const GET = async (
  req: MedusaRequest<ListInventoryOrdersQuery>,
  res: MedusaResponse,
) => {
  // Validate and parse query params
  const query = req.validatedQuery;
  // Prepare workflow input
  const filters = {
    status: query.status as InventoryOrderStatus,
    quantity: query.quantity as number,
    total_price: query.total_price as number,
    expected_delivery_date: query.expected_delivery_date as Date,
    order_date: query.order_date as Date,
    id: query.q as string
    // Add more fields as needed
  };
  const pagination = {
    offset: query.offset as number,
    limit: query.limit as number,
  };

  const findConfig = {
    order: parseOrderParam(query.order),
    // Add more FindConfig options as needed
  };

  // Call the workflow
  const { result, errors } = await listInventoryOrdersWorkflow(req.scope).run({
    input: {
      filters,
      pagination,
      findConfig
    }
  });

  if (errors.length > 0) {
    throw errors;
  }

  res.status(200).json({
    inventory_orders: result.inventoryOrders,
    count: result.count,
    offset: pagination.offset,
    limit: pagination.limit,
  });
};



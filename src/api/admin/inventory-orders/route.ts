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



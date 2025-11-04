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

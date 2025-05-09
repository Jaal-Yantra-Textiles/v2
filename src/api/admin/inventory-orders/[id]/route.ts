import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { updateInventoryOrdersSchema, UpdateInventoryOrder } from "../validators";
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
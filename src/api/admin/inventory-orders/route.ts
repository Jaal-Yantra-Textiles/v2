import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { createInventoryOrderWorkflow } from "../../../workflows/inventory_orders/create-inventory-orders";
import { CreateInventoryOrder } from "./validators";
import { refetchInventoryOrder } from "./helpers";

export const POST = async (
  req: MedusaRequest<CreateInventoryOrder>,
  res: MedusaResponse,
) => {
    console.log(req.validatedBody)
  const { errors } = await createInventoryOrderWorkflow(req.scope).run({
    input: {
     ...req.validatedBody
    },
  });

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  const inventoryOrder = await refetchInventoryOrder(
    req.params.id,
    req.scope,
  );

  res.status(201).json( inventoryOrder );
};



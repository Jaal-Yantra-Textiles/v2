import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import InventoryOrderService from "../../modules/inventory_orders/service";
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders";

type UpdateInventoryOrderStepInput = {
  id: string;
  update: {
    status?: "Pending" | "Processing" | "Shipped" | "Delivered" | "Cancelled";
    metadata?: Record<string, any>;
    quantity?: number;
    total_price?: number;
    expected_delivery_date?: Date;
    order_date?: Date;
    shipping_address?: Record<string, any>;
    is_sample?: boolean;
  };
};

export const updateInventoryOrderStep = createStep(
  "update-inventory-order-step",
  async (input: UpdateInventoryOrderStepInput, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    const order = await inventoryOrderService.updateInventoryOrders({
      id: input.id,
      ...input.update
    });
    return new StepResponse(order);
  }
);

type UpdateInventoryOrderWorkflowInput = UpdateInventoryOrderStepInput;

export const updateInventoryOrderWorkflow = createWorkflow(
  "update-inventory-order",
  (input: UpdateInventoryOrderWorkflowInput) => {
    const order = updateInventoryOrderStep(input);
    return new WorkflowResponse(order);
  }
);

import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

import InventoryOrderService from "../../modules/inventory_orders/service";
import { InferTypeOf, FindConfig } from "@medusajs/framework/types";
import InventoryOrder from "../../modules/inventory_orders/models/order";
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders";

// Infer the InventoryOrder type from your model definition

export type InventoryOrderType = InferTypeOf<typeof InventoryOrder>;

import { InventoryOrderStatus } from "../../modules/inventory_orders/constants";

export type ListInventoryOrdersStepInput = {
  filters: Partial<Omit<InventoryOrderType, "status"> & { status?: InventoryOrderStatus }>;
  findConfig?: FindConfig<InventoryOrderType>;
  pagination: {
    offset: number;
    limit: number;
  };
};

export const listInventoryOrdersStep = createStep(
  "list-inventoryorders-step",
  async (input: ListInventoryOrdersStepInput, { container }) => {
    const inventoryOrderService: InventoryOrderService = container.resolve(ORDER_INVENTORY_MODULE);
    const [inventoryOrders, count] = await inventoryOrderService.listAndCountInventoryOrders(
      input.filters,
      {
        ...(input.findConfig || {}),
        skip: input.pagination.offset,
        take: input.pagination.limit,
      },
      
    );
    return new StepResponse({ inventoryOrders, count }, null);
  }
);

export type ListInventoryOrdersWorkflowInput = ListInventoryOrdersStepInput;

export const listInventoryOrdersWorkflow = createWorkflow(
  {
    name: "list-inventoryorders",
    store: true,
  },
  (input: ListInventoryOrdersWorkflowInput) => {
    const result = listInventoryOrdersStep(input);
    return new WorkflowResponse(result);
  }
);

export default listInventoryOrdersWorkflow;

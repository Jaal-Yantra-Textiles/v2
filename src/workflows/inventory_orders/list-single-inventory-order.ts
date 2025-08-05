import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

export type ListSingleInventoryOrderStepInput = {
  id: string;
  fields: string[];
};

export const listSingleInventoryOrderStep = createStep(
  "list-single-inventory-order-step",
  async (input: ListSingleInventoryOrderStepInput, { container }) => {
    // Always include '*' for full fetch if not specified
    if (!input.fields.includes("*")) {
      input.fields.push("*");
    }
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: input.fields || ["*", 'partner.*'],
      filters: {
        id: input.id,
      },
    });
    if (!orders[0]) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory Order with id ${input.id} was not found`
      );
    }
    return new StepResponse(orders[0], orders[0]?.id);
  },
);

export type ListSingleInventoryOrderWorkflowInput = ListSingleInventoryOrderStepInput;

export const listSingleInventoryOrderWorkflow = createWorkflow(
  {
    name: "list-single-inventory-order",
    store: true,
  },
  (input: ListSingleInventoryOrderWorkflowInput) => {
    const result = listSingleInventoryOrderStep(input);
    return new WorkflowResponse(result);
  },
);

export default listSingleInventoryOrderWorkflow;

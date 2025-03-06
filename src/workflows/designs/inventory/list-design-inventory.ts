import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { DESIGN_MODULE } from "../../../modules/designs";


export const listDesignInventoryStep = createStep(
    'list-design-inventory',
    async (input: ListDesignInventoryWorkFlowInput, { container }) => {
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
            entity: 'designs',
            fields: ['inventory_items.*'],
            filters: {
                id: input.design_id
            }
        })
        
        // Handle the case when no design is found
        if (!data || data.length === 0) {
            return new StepResponse({ inventory_items: [] })
        }

        // Get the first design (since we're querying by ID, there should only be one)
        const design = data[0]

        // Ensure inventory_items is always an array
        const inventoryItems = Array.isArray(design.inventory_items)
            ? design.inventory_items
            : design.inventory_items
            ? [design.inventory_items]
            : []

        return new StepResponse({ inventory_items: inventoryItems })
    }
)


interface ListDesignInventoryWorkFlowInput {
    design_id: string;
}

export const listDesignInventoryWorkflow = createWorkflow(
    {
        name: 'list-design-inventory',
        store: true,
    },
    (input: ListDesignInventoryWorkFlowInput) => {
        const result = listDesignInventoryStep(input);
        return new WorkflowResponse(result);
    },
);
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";

export type ListAndCountPersonsWithFilterWorkFlowInput = {
    filters: Record<string, any>
    pagination: {
        skip: any
        take: any
        order?: {
            [key: string]: "ASC" | "DESC"
        }
    }
    withDeleted?: boolean
    fields?: string
}

const listAndCountPersonsWithFilterStep = createStep(
    "list-and-count-persons-with-filter-step",
    async (input: ListAndCountPersonsWithFilterWorkFlowInput, { container }) => {
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        // Let Medusa handle the search through searchable fields
        const { filters } = input
        // Ensure pagination respects the limit
        const { pagination } = input
        
        const fields = ["id"]
        if (input.fields) {
          fields.push(...input.fields.split(',').map(f => f.trim()))
        }
        //const take = Math.min(pagination.take || 10, 10) // Cap at 10 items
        const { data, metadata } = await query.graph({
            entity: "person",
            fields: fields,
            filters,
            pagination: {
                ...pagination,
                take: pagination.take || 10
            },
            withDeleted: input.withDeleted
        })
        return new StepResponse({ data, metadata })
    }
)


export const listAndCountPersonsWithFilterWorkflow = createWorkflow(
    "list-and-count-persons-with-filter",
    (input: ListAndCountPersonsWithFilterWorkFlowInput) => {
        const result = listAndCountPersonsWithFilterStep(input);
        return new WorkflowResponse(result);
    },
);
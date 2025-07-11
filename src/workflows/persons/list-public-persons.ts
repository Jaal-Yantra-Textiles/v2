import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";


export type ListPublicPersonsWorkflowInput = {
    filters: Record<string, any>
    pagination: {
        skip: any
        take: any
        order?: {
            [key: string]: "ASC" | "DESC"
        }
    }
    withDeleted?: boolean
}

const listPublicPersonsStep = createStep(
    "list-public-persons-step",
    async (input: ListPublicPersonsWorkflowInput, { container }) => {
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const { filters, pagination } = input
        
        const fields = [
            "id",
            "first_name",
            "last_name",
            "addresses.latitude",
            "addresses.longitude",
            "addresses.address_1",
            "addresses.city",
            "addresses.postal_code",
            "person_type.name"
        ]

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

export const listPublicPersonsWorkflow = createWorkflow(
    "list-public-persons",
    (input: ListPublicPersonsWorkflowInput) => {
        const result = listPublicPersonsStep(input);
        return new WorkflowResponse(result);
    },
);

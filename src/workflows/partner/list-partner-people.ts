import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { RemoteQueryFunction } from "@medusajs/types"


type ListPartnerPeopleWorkFlowInput = {
    partnerId: string
}

const listPeopleOfPartnerStep = createStep(
    "list-partner-people",
    async(input: ListPartnerPeopleWorkFlowInput, { container }) => {
        const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>
        const { data: peopleOfPartner } = await query.graph({
            entity: 'partners',
            fields: ['*','people.*', 'people.id'],
            filters: {
                id: input.partnerId
            }
        })
        return new StepResponse(peopleOfPartner)
    }
)

export const listPeopleOfPartner = createWorkflow(
    "list-partner-people",
    (input: ListPartnerPeopleWorkFlowInput) => {
        const people = listPeopleOfPartnerStep(input)
        return new WorkflowResponse(people)
    }
)
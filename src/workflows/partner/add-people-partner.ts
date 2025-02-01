import { 
    createStep,
    createWorkflow,
    StepResponse,
    WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { LinkDefinition } from "@medusajs/framework/types"

import { PARTNER_MODULE } from "../../modules/partner"
import { PERSON_MODULE } from "../../modules/person"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import createPersoninBatchWorkflow, { CreatePersonWorkFlowInput } from "../persons/create-people-batch"

export type AddPeoplePartnerWorkflowInput = {
    partner_id: string
    people: CreatePersonWorkFlowInput[]
}

const prepareLinkDefinitionsStep = createStep(
    "prepare-link-definitions",
    async (
        input: { 
            people: any[], 
            partner_id: string 
        }, 
        { container }
    ) => {

        const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
        const links: LinkDefinition[] = []

        // Create a link definition for each person
        for (const person of input.people) {
            links.push({
                [PARTNER_MODULE]: {
                    partner_id: input.partner_id
                },
                [PERSON_MODULE]: {
                    person_id: person.id
                },
                data: {
                    partner_id: input.partner_id,
                    person_id: person.id
                }
            })
        }

        await remoteLink.create(links)
        return new StepResponse(links)
    },
    async (links: LinkDefinition[], { container }) => {
        const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
        await remoteLink.dismiss(links)
    }
)

const addPeoplePartnerWorkflow = createWorkflow(
    {
        name: "add-people-partner",
        store: true

    },
    (input: AddPeoplePartnerWorkflowInput) => {
        // Create people using transform to map over the array
        const peopleSteps = createPersoninBatchWorkflow.runAsStep({
            input: input.people
        })
        
        // Create link definitions and link them
        const links = prepareLinkDefinitionsStep({
            people: peopleSteps,
            partner_id: input.partner_id
        })

        return new WorkflowResponse({
            partner_id: input.partner_id,
            peopleSteps,
            links
        })
    }
)

export default addPeoplePartnerWorkflow

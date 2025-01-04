import { container } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { LinkDefinition } from "@medusajs/framework/types"
import {
  createStep,
  WorkflowResponse,
  StepResponse,
  createWorkflow,
} from "@medusajs/framework/workflows-sdk"
import { PERSON_MODULE } from "../../modules/person"
import { PERSON_TYPE_MODULE } from "../../modules/persontype"


type AssociatePersonTypesInput = {
  personId: string
  typeIds: string[]
}

const prepareLinkDefinitionsStep = createStep(
  "prepare-link-definitions",
  async (input: AssociatePersonTypesInput) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)
    const links: string[] = []

    // Create a separate link for each type ID
    for (const typeId of input.typeIds) {
      const link = await remoteLink.create({
        [PERSON_MODULE]: {
          person_id: input.personId
        },
        [PERSON_TYPE_MODULE]: {
          person_type_id: typeId
        },
        data: {
          person_id: input.personId,
          person_type_id: typeId
        }
      })
      links.push(link as unknown as string)
    }

    return new StepResponse(links)
  }, 
  async (links, { container }) => {
    if (!links?.length) return
    const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)
    
    // Rollback each link individually
    for (const link of links) {
      await remoteLink.dismiss(link)
    }
  }
)

export const associatePersonTypesWorkflow = createWorkflow(
  "associate-person-types",
  (input: AssociatePersonTypesInput) => {
    const prepareStep = prepareLinkDefinitionsStep(input)
    return new WorkflowResponse([prepareStep])
  }
)

export default associatePersonTypesWorkflow

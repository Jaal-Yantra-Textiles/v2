import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createStep,
  WorkflowResponse,
  StepResponse,
  createWorkflow,
} from "@medusajs/framework/workflows-sdk"
import { PERSON_MODULE } from "../../modules/person"
import { PERSON_TYPE_MODULE } from "../../modules/persontype"
import { LinkDefinition } from "@medusajs/framework/types"
import type { Link } from "@medusajs/modules-sdk"

type AssociatePersonTypesInput = {
  personId: string
  typeIds: string[]
}

const prepareLinkDefinitionsStep = createStep(
  "prepare-link-definitions",
  async (input: AssociatePersonTypesInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const links:  LinkDefinition[] = []

    // Create a separate link for each type ID
    for (const typeId of input.typeIds) {
     links.push({
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
    }
    await remoteLink.create(links)
    return new StepResponse(links)
  }, 
  async (links, { container }) => {
    if (!links?.length) return
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    
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

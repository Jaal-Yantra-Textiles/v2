import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createStep,
  WorkflowResponse,
  StepResponse,
  createWorkflow,
} from "@medusajs/framework/workflows-sdk"
import { PARTNER_MODULE } from "../../modules/partner"
import { PERSON_TYPE_MODULE } from "../../modules/persontype"
import { LinkDefinition } from "@medusajs/framework/types"
import type { Link } from "@medusajs/modules-sdk"

type AssociatePartnerPersonTypesInput = {
  partnerId: string
  personTypeIds: string[]
}

const associatePartnerPersonTypesStep = createStep(
  "associate-partner-person-types",
  async (input: AssociatePartnerPersonTypesInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    // Dismiss existing links first so this is an idempotent "set" operation
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: existing } = await query.graph({
      entity: "partners",
      fields: ["person_types.id"],
      filters: { id: input.partnerId },
    })

    const existingTypeIds = ((existing?.[0] as any)?.person_types || []).map((pt: any) => pt.id) as string[]

    if (existingTypeIds.length > 0) {
      const dismissLinks: LinkDefinition[] = existingTypeIds.map((typeId) => ({
        [PARTNER_MODULE]: { partner_id: input.partnerId },
        [PERSON_TYPE_MODULE]: { person_type_id: typeId },
      }))
      await remoteLink.dismiss(dismissLinks)
    }

    // Create new links
    const links: LinkDefinition[] = input.personTypeIds.map((typeId) => ({
      [PARTNER_MODULE]: { partner_id: input.partnerId },
      [PERSON_TYPE_MODULE]: { person_type_id: typeId },
    }))

    if (links.length > 0) {
      await remoteLink.create(links)
    }

    return new StepResponse({ created: links, dismissed: existingTypeIds })
  },
  async (result, { container }) => {
    if (!result) return
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    // Rollback: dismiss what we created, recreate what we dismissed
    if (result.created.length > 0) {
      await remoteLink.dismiss(result.created)
    }

    if (result.dismissed.length > 0) {
      const restoreLinks: LinkDefinition[] = result.dismissed.map((typeId: string) => ({
        [PARTNER_MODULE]: { partner_id: result.created[0]?.[PARTNER_MODULE]?.partner_id },
        [PERSON_TYPE_MODULE]: { person_type_id: typeId },
      }))
      await remoteLink.create(restoreLinks)
    }
  }
)

export const associatePartnerPersonTypesWorkflow = createWorkflow(
  "associate-partner-person-types",
  (input: AssociatePartnerPersonTypesInput) => {
    const result = associatePartnerPersonTypesStep(input)
    return new WorkflowResponse(result)
  }
)

export default associatePartnerPersonTypesWorkflow

import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../modules/partner"
import PartnerService from "../../modules/partner/service"

export type UpdatePartnerInput = {
  id: string
  data: Partial<{
    name: string
    handle: string
    logo: string | null
    status: "active" | "inactive" | "pending"
    is_verified: boolean
    metadata: Record<string, any> | null
  }>
}

export const updatePartnerStep = createStep(
  "update-partner",
  async (input: UpdatePartnerInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)

    // Fetch current partner for existence check and rollback snapshot
    const { data } = await query.graph({
      entity: "partners",
      fields: ["*"],
      filters: { id: input.id },
    })

    const existing = (data || [])[0]
    if (!existing) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Partner with id ${input.id} was not found`
      )
    }

    const updated = await partnerService.updatePartners({
      id: input.id,
      ...input.data,
    } as any)

    return new StepResponse(updated as any, existing)
  },
  // Rollback to previous state if available
  async (previous, { container }) => {
    if (!previous) return
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    await partnerService.updatePartners({
      id: previous.id,
      name: previous.name,
      handle: previous.handle,
      logo: previous.logo ?? null,
      status: previous.status,
      is_verified: previous.is_verified,
      metadata: previous.metadata ?? null,
    } as any)
  }
)

export const updatePartnerWorkflow = createWorkflow(
  {
    name: "update-partner",
    store: true,
  },
  (input: UpdatePartnerInput) => {
    const result = updatePartnerStep(input)
    return new WorkflowResponse(result)
  }
)

export default updatePartnerWorkflow

import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_CAPABILITY_MODULE } from "../../modules/partner_capability"
import { assertPartnerExistsStep } from "./steps/assert-partner-exists"

export type DeletePartnerCapabilityWorkflowInput = {
  partner_id: string
  sample_id: string
}

const deletePartnerCapabilityStep = createStep(
  "delete-partner-capability-step",
  async (input: DeletePartnerCapabilityWorkflowInput, { container }) => {
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)

    /**
     * 🔴 The sample is looked up THROUGH the partner: filtered by both id and
     * partner_id, so a sample id that belongs to another partner 404s rather
     * than deleting their evidence — the same tenant guard the credit-apply
     * route uses.
     */
    const rows = await service.listPartnerCapabilitySamples({
      id: input.sample_id,
      partner_id: input.partner_id,
    } as any)

    const sample = rows?.[0]
    if (!sample) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `capability sample ${input.sample_id} does not belong to partner ${input.partner_id}`
      )
    }

    await service.deletePartnerCapabilitySamples(input.sample_id)

    return new StepResponse(
      { id: input.sample_id, deleted: true },
      // Compensation: restore the row as it was, photographs included. The
      // uploaded media files are never touched — other samples may reference
      // them, and the media module owns their lifecycle.
      { sample: { ...sample } as Record<string, unknown> }
    )
  },
  async (
    comp: { sample: Record<string, unknown> } | undefined,
    { container }
  ) => {
    if (!comp?.sample) return
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)
    // Recreated with its original id, so links held by other rows (e.g.
    // design-inquiry answers) survive the round trip.
    await service.createPartnerCapabilitySamples(comp.sample as any)
  }
)

export const deletePartnerCapabilityWorkflow = createWorkflow(
  "delete-partner-capability",
  (input: DeletePartnerCapabilityWorkflowInput) => {
    assertPartnerExistsStep({ partner_id: input.partner_id })
    const result = deletePartnerCapabilityStep(input)
    return new WorkflowResponse(result)
  }
)

export default deletePartnerCapabilityWorkflow

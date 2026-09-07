import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { PARTNER_CAPABILITY_MODULE } from "../../modules/partner_capability"
import { attachCapabilityMedia } from "./capability-media"
import { assertPartnerExistsStep } from "./steps/assert-partner-exists"

export type ListPartnerCapabilitiesWorkflowInput = {
  partner_id: string
  technique?: string
  material?: string
  limit?: number
  offset?: number
}

/** A ceiling on one partner's library page, not pagination. */
const MAX_CAPABILITY_PAGE = 100

/**
 * One partner's capability library, newest-first by captured_at — NOT
 * created_at: the row is evidence about a loom at a moment in time, and its
 * order should say when the work was made, not when it was typed up.
 */
const listPartnerCapabilitiesStep = createStep(
  "list-partner-capabilities-step",
  async (input: ListPartnerCapabilitiesWorkflowInput, { container }) => {
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)

    const filters: Record<string, unknown> = { partner_id: input.partner_id }
    if (input.technique) filters.technique = input.technique
    if (input.material) filters.material = input.material

    const [samples, count] = await service.listAndCountPartnerCapabilitySamples(
      filters as any,
      {
        order: { captured_at: "DESC" },
        take: Math.min(Number(input.limit ?? 20), MAX_CAPABILITY_PAGE),
        skip: Number(input.offset ?? 0),
      }
    )

    return new StepResponse({
      samples: await attachCapabilityMedia(container, samples ?? []),
      count,
    })
  }
)

export const listPartnerCapabilitiesWorkflow = createWorkflow(
  "list-partner-capabilities",
  (input: ListPartnerCapabilitiesWorkflowInput) => {
    assertPartnerExistsStep({ partner_id: input.partner_id })
    const result = listPartnerCapabilitiesStep(input)
    return new WorkflowResponse(result)
  }
)

export default listPartnerCapabilitiesWorkflow

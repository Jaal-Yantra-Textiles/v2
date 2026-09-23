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
  product_type?: string
  /**
   * Attach learned knowledge. ADMIN ONLY: an operator's note ("slow to reply
   * in harvest season") is about the partner, not for them, and the partner
   * portal reads its own library through this same workflow.
   */
  include_knowledge?: boolean
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
    if (input.product_type) filters.product_type = input.product_type

    const [samples, count] = await service.listAndCountPartnerCapabilitySamples(
      filters as any,
      {
        order: { captured_at: "DESC" },
        take: Math.min(Number(input.limit ?? 20), MAX_CAPABILITY_PAGE),
        skip: Number(input.offset ?? 0),
      }
    )

    const withMedia = await attachCapabilityMedia(container, samples ?? [])

    // Each sample carries what we have LEARNED about it (#2249), oldest first
    // so the record reads as it accumulated. Partner-wide facts ride alongside.
    if (!input.include_knowledge) {
      return new StepResponse({ samples: withMedia, count })
    }

    const ids = withMedia.map((s: any) => s.id)
    const knowledge = await service.listPartnerCapabilityKnowledges(
      { partner_id: input.partner_id },
      { order: { observed_at: "ASC" }, take: 500 }
    )
    const bySample = new Map<string, any[]>()
    const partnerWide: any[] = []
    for (const k of knowledge ?? []) {
      if (k.sample_id && ids.includes(k.sample_id)) {
        bySample.set(k.sample_id, [...(bySample.get(k.sample_id) ?? []), k])
      } else if (!k.sample_id) {
        partnerWide.push(k)
      }
    }

    return new StepResponse({
      samples: withMedia.map((s: any) => ({
        ...s,
        knowledge: bySample.get(s.id) ?? [],
      })),
      count,
      partner_knowledge: partnerWide,
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

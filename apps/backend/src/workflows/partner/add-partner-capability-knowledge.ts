/**
 * Record one thing we have learned about a partner's capability (#2249).
 *
 * Append-only: a new fact never edits an old one, so the record shows how
 * what we know accumulated — and a fact that stopped being true is answered by
 * a newer fact, not by overwriting the evidence that it once was.
 */
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"

import { PARTNER_CAPABILITY_MODULE } from "../../modules/partner_capability"
import { assertPartnerExistsStep } from "./steps/assert-partner-exists"

export type AddPartnerCapabilityKnowledgeWorkflowInput = {
  partner_id: string
  fact: string
  /** The sample it is about; omit for a partner-wide fact. */
  sample_id?: string | null
  source_url?: string | null
  /** When it was observed. Defaults to now, and the route says so. */
  observed_at?: Date | null
}

const addKnowledgeStep = createStep(
  "add-partner-capability-knowledge-step",
  async (input: AddPartnerCapabilityKnowledgeWorkflowInput, { container }) => {
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)

    if (input.sample_id) {
      const [sample] = await service.listPartnerCapabilitySamples({ id: input.sample_id })
      // Another partner's sample is a 404: a fact must not attach across tenants.
      if (!sample || sample.partner_id !== input.partner_id) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          "Capability sample not found for this partner"
        )
      }
    }

    const knowledge = await service.createPartnerCapabilityKnowledges({
      partner_id: input.partner_id,
      sample_id: input.sample_id ?? null,
      fact: input.fact.trim(),
      source: "admin",
      source_url: input.source_url ?? null,
      observed_at: input.observed_at ?? new Date(),
    })
    return new StepResponse({ knowledge }, knowledge.id)
  },
  async (id: string | undefined, { container }) => {
    if (!id) return
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)
    await service.deletePartnerCapabilityKnowledges(id)
  }
)

export const addPartnerCapabilityKnowledgeWorkflow = createWorkflow(
  "add-partner-capability-knowledge",
  (input: AddPartnerCapabilityKnowledgeWorkflowInput) => {
    assertPartnerExistsStep({ partner_id: input.partner_id })
    return new WorkflowResponse(addKnowledgeStep(input))
  }
)

export default addPartnerCapabilityKnowledgeWorkflow

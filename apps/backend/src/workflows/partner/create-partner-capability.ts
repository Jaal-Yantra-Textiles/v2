import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { PARTNER_CAPABILITY_MODULE } from "../../modules/partner_capability"
import { attachCapabilityMedia } from "./capability-media"
import { assertPartnerExistsStep } from "./steps/assert-partner-exists"

export type CreatePartnerCapabilityWorkflowInput = {
  /**
   * The partner whose library this lands in. Always the caller's to name —
   * never from a body the end user could point at a competitor.
   */
  partner_id: string
  title: string
  technique?: string | null
  material?: string | null
  /** media_file ids — the photograph itself must be uploaded beforehand. */
  media_file_ids?: string[] | null
  notes?: string | null
  /**
   * When the photographed work was actually on the loom. NOT created_at: a
   * photo typed up three weeks later describes a capability that may already
   * be gone, and the library is only trustworthy if it says how stale it is.
   * The route defaults this to now and SAYS SO in the response.
   */
  captured_at?: Date | null
}

const createPartnerCapabilityStep = createStep(
  "create-partner-capability-step",
  async (input: CreatePartnerCapabilityWorkflowInput, { container }) => {
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)

    const sample = await service.createPartnerCapabilitySamples({
      partner_id: input.partner_id,
      title: input.title,
      technique: input.technique ?? null,
      material: input.material ?? null,
      media_file_ids: input.media_file_ids?.length ? input.media_file_ids : null,
      notes: input.notes ?? null,
      // The model distinguishes an operator typing up a conversation from the
      // partner's own structured answer — `source` is the evidence trail.
      source: "admin",
      captured_at: input.captured_at ?? new Date(),
    } as any)

    // Attached here so a caller rendering from the create result and one
    // rendering from the listing see the SAME shape.
    const [withMedia] = await attachCapabilityMedia(container, [sample])

    return new StepResponse(
      { sample: withMedia ?? sample },
      { sample_id: sample.id }
    )
  },
  async (comp: { sample_id: string } | undefined, { container }) => {
    if (!comp) return
    const service: any = container.resolve(PARTNER_CAPABILITY_MODULE)
    await service.deletePartnerCapabilitySamples(comp.sample_id)
  }
)

export const createPartnerCapabilityWorkflow = createWorkflow(
  "create-partner-capability",
  (input: CreatePartnerCapabilityWorkflowInput) => {
    assertPartnerExistsStep({ partner_id: input.partner_id })
    const result = createPartnerCapabilityStep(input)
    return new WorkflowResponse(result)
  }
)

export default createPartnerCapabilityWorkflow

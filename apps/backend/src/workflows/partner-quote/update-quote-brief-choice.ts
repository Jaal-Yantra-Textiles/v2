import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import type { AdminUpdateQuoteBriefChoiceReqType } from "../../api/admin/quote-briefs/validators"
import { PARTNER_QUOTE_MODULE } from "../../modules/partner-quote"
import { assertBriefChoiceOwnership } from "../../modules/partner-quote/lib/brief-choice-ownership"

export type UpdateQuoteBriefChoiceInput = AdminUpdateQuoteBriefChoiceReqType & {
  brief_id: string
  choice_id: string
}

/**
 * Once a brief has become a quote (or is closed) its estimates are history:
 * the quote carries the real price, so the brief's rates stop moving.
 */
export const BRIEF_CHOICE_LOCKED_STATUSES = ["quoted", "closed"] as const

/**
 * #2608 — attach (or clear) a partner's rate on one choice of a brief, e.g.
 * once Sharlho quotes for stitching. The rate is still read live by the brief
 * view; this only says WHICH rate. Sends nothing to the buyer.
 */
const updateQuoteBriefChoiceStep = createStep(
  "update-quote-brief-choice-step",
  async (input: UpdateQuoteBriefChoiceInput, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const service: any = container.resolve(PARTNER_QUOTE_MODULE)

    const { data } = await query.graph({
      entity: "partner_quote_brief_choice",
      fields: ["id", "partner_id", "rate_id", "sample_ids", "note", "step.option.brief.id", "step.option.brief.status"],
      filters: { id: input.choice_id },
    })
    const choice = (data as any[])[0]
    // A choice id from another brief reads as not found, never as editable.
    if (!choice || choice.step?.option?.brief?.id !== input.brief_id) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Choice ${input.choice_id} not found on brief ${input.brief_id}`)
    }
    const status = choice.step.option.brief.status
    if ((BRIEF_CHOICE_LOCKED_STATUSES as readonly string[]).includes(status)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `This brief is ${status}; its partner rates can no longer change.`
      )
    }

    const patch: Record<string, unknown> = {}
    if (input.rate_id !== undefined) patch.rate_id = input.rate_id
    if (input.note !== undefined) patch.note = input.note
    if (input.sample_ids !== undefined) patch.sample_ids = input.sample_ids.length ? input.sample_ids : null

    await assertBriefChoiceOwnership(container, [
      {
        partner_id: choice.partner_id,
        rate_id: input.rate_id ?? null,
        sample_ids: input.sample_ids ?? null,
      },
    ])

    const previous = { rate_id: choice.rate_id ?? null, sample_ids: choice.sample_ids ?? null, note: choice.note ?? null }
    if (Object.keys(patch).length) {
      await service.updatePartnerQuoteBriefChoices({ id: choice.id, ...patch })
    }
    return new StepResponse({ id: choice.id }, { id: choice.id, previous })
  },
  async (comp: { id: string; previous: Record<string, unknown> } | undefined, { container }) => {
    if (!comp) return
    await container.resolve<any>(PARTNER_QUOTE_MODULE).updatePartnerQuoteBriefChoices({ id: comp.id, ...comp.previous })
  }
)

export const updateQuoteBriefChoiceWorkflow = createWorkflow(
  "update-quote-brief-choice",
  (input: UpdateQuoteBriefChoiceInput) => {
    const result = updateQuoteBriefChoiceStep(input)
    return new WorkflowResponse(result)
  }
)

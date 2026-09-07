import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { PARTNER_ONBOARDING_PROFILE_MODULE } from "../../modules/partner-onboarding-profile"
import type { OnboardingProfileUpdateInput } from "../../api/partners/onboarding-profile/validators"
import { assertPartnerExistsStep } from "./steps/assert-partner-exists"

export type UpsertPartnerOnboardingProfileWorkflowInput = {
  partner_id: string
  /**
   * Only the supplied fields are written, so a caller can file one answer at
   * a time — same partial-progress semantics as the partner's own wizard.
   */
  data: OnboardingProfileUpdateInput
}

const upsertPartnerOnboardingProfileStep = createStep(
  "upsert-partner-onboarding-profile-step",
  async (
    input: UpsertPartnerOnboardingProfileWorkflowInput,
    { container }
  ) => {
    const service: any = container.resolve(PARTNER_ONBOARDING_PROFILE_MODULE)

    const existing = await service.findByPartner(input.partner_id)

    let profile
    if (existing) {
      profile = await service.updatePartnerOnboardingProfiles({
        id: existing.id,
        ...input.data,
      })
    } else {
      profile = await service.createPartnerOnboardingProfiles({
        partner_id: input.partner_id,
        ...input.data,
      })
    }

    return new StepResponse(
      { profile },
      // Compensation: restore what was there before — the prior row, or none.
      { previous: existing ?? null, partner_id: input.partner_id }
    )
  },
  async (
    comp: {
      previous: Record<string, unknown> | null
      partner_id: string
    } | undefined,
    { container }
  ) => {
    if (!comp) return
    const service: any = container.resolve(PARTNER_ONBOARDING_PROFILE_MODULE)

    if (comp.previous) {
      // A partial update that is rolled back must not leave the new answers
      // standing — restore the prior values on the same row.
      const { id, ...prev } = comp.previous
      await service.updatePartnerOnboardingProfiles({ id, ...prev })
    } else {
      // There was no profile before this run — remove the row we created.
      const created = await service.findByPartner(comp.partner_id)
      if (created) await service.deletePartnerOnboardingProfiles(created.id)
    }
  }
)

export const upsertPartnerOnboardingProfileWorkflow = createWorkflow(
  "upsert-partner-onboarding-profile",
  (input: UpsertPartnerOnboardingProfileWorkflowInput) => {
    assertPartnerExistsStep({ partner_id: input.partner_id })
    const result = upsertPartnerOnboardingProfileStep(input)
    return new WorkflowResponse(result)
  }
)

export default upsertPartnerOnboardingProfileWorkflow

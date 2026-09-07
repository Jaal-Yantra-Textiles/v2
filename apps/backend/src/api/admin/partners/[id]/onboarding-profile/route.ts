/**
 * @file Admin surface for a partner's onboarding questionnaire (#843, #648).
 * @description The onboarding profile is captured at registration by the
 *   partner's own wizard; this exposes it to an operator — read it, and file
 *   answers the partner gave over a call or WhatsApp rather than in the
 *   wizard, through the same upsert semantics the wizard itself uses.
 * @module API/Admin/Partners/OnboardingProfile
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PARTNER_ONBOARDING_PROFILE_MODULE } from "../../../../../modules/partner-onboarding-profile"
import { upsertPartnerOnboardingProfileWorkflow } from "../../../../../workflows/partner/upsert-partner-onboarding-profile"
import { assertPartnerExists } from "../lib/partner-inspection"
import type { OnboardingProfileUpdateInput } from "../../../../../api/partners/onboarding-profile/validators"

/**
 * GET /admin/partners/:id/onboarding-profile
 *
 * Mirrors `GET /partners/onboarding-profile`. Returns `null` when the partner
 * has not started the wizard — a partner with no profile is an ordinary state
 * (and, for the console, a useful signal), not a 404.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params

  await assertPartnerExists(partnerId, req.scope)

  const service: any = req.scope.resolve(PARTNER_ONBOARDING_PROFILE_MODULE)
  const profile = await service.findByPartner(partnerId)

  return res.status(200).json({ onboarding_profile: profile ?? null })
}

/**
 * PUT /admin/partners/:id/onboarding-profile
 *
 * Upserts the partner's questionnaire, filed by an operator. The partner-side
 * wizard owns the answers in the ordinary flow; this exists for the cases the
 * wizard cannot reach — the partner answered over WhatsApp or a call, and the
 * operator is filing what was said. Same partial-progress semantics as the
 * partner route: only the supplied fields are written, so an operator can
 * record one answer at a time.
 */
export const PUT = async (
  req: MedusaRequest<OnboardingProfileUpdateInput>,
  res: MedusaResponse
) => {
  const { id: partnerId } = req.params
  const data = ((req as any).validatedBody || {}) as OnboardingProfileUpdateInput

  const { result, errors } = await upsertPartnerOnboardingProfileWorkflow(
    req.scope
  ).run({
    input: { partner_id: partnerId, data },
  })

  if (errors?.length) {
    throw (
      errors[0].error ||
      new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Failed to save onboarding profile"
      )
    )
  }

  return res.status(200).json({ onboarding_profile: result.profile })
}

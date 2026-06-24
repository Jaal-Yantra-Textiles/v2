/**
 * @file Partner onboarding-profile API (issue #648, slice 1)
 * @description Read + upsert the post-registration onboarding questionnaire
 *   profile for the authenticated partner.
 * @module API/Partners/OnboardingProfile
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"
import { PARTNER_ONBOARDING_PROFILE_MODULE } from "../../../modules/partner-onboarding-profile"
import type { OnboardingProfileUpdateInput } from "./validators"

/**
 * GET /partners/onboarding-profile
 * Returns the authenticated partner's onboarding profile, or null if the
 * partner has not started the wizard yet.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  const service: any = req.scope.resolve(PARTNER_ONBOARDING_PROFILE_MODULE)
  const profile = await service.findByPartner(partner.id)

  return res.status(200).json({ onboarding_profile: profile })
}

/**
 * PUT /partners/onboarding-profile
 * Upserts the authenticated partner's onboarding profile. Creates the row on
 * first save, updates it thereafter. Only the supplied fields are written, so
 * the wizard can persist progress step-by-step.
 */
export const PUT = async (
  req: AuthenticatedMedusaRequest<OnboardingProfileUpdateInput>,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  const data = (req.validatedBody || {}) as OnboardingProfileUpdateInput

  const service: any = req.scope.resolve(PARTNER_ONBOARDING_PROFILE_MODULE)
  const existing = await service.findByPartner(partner.id)

  let profile
  if (existing) {
    profile = await service.updatePartnerOnboardingProfiles({
      id: existing.id,
      ...data,
    })
  } else {
    profile = await service.createPartnerOnboardingProfiles({
      partner_id: partner.id,
      ...data,
    })
  }

  return res.status(200).json({ onboarding_profile: profile })
}

/**
 * @file Admin read-proxy: a partner's onboarding questionnaire (#843).
 * @description The onboarding profile (#648) is captured at registration but
 *   has never had an admin-side read surface — it was write-only from the
 *   platform's point of view. This exposes it for inspection.
 * @module API/Admin/Partners/OnboardingProfile
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PARTNER_ONBOARDING_PROFILE_MODULE } from "../../../../../modules/partner-onboarding-profile"
import { assertPartnerExists } from "../lib/partner-inspection"

/**
 * GET /admin/partners/:id/onboarding-profile
 *
 * Mirrors `GET /partners/onboarding-profile`. Returns `null` when the partner
 * has not started the wizard — a partner with no profile is an ordinary state
 * (and, for the console, a useful signal), not a 404.
 *
 * READ-ONLY: the partner owns their own answers; admin does not edit them here.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: partnerId } = req.params

  await assertPartnerExists(partnerId, req.scope)

  const service: any = req.scope.resolve(PARTNER_ONBOARDING_PROFILE_MODULE)
  const profile = await service.findByPartner(partnerId)

  return res.status(200).json({ onboarding_profile: profile ?? null })
}

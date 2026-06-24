import { Module } from "@medusajs/framework/utils"
import PartnerOnboardingProfileService from "./service"

export const PARTNER_ONBOARDING_PROFILE_MODULE = "partner_onboarding_profile"

export default Module(PARTNER_ONBOARDING_PROFILE_MODULE, {
  service: PartnerOnboardingProfileService,
})

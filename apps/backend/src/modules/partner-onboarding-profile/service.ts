import { MedusaService } from "@medusajs/framework/utils"
import PartnerOnboardingProfile from "./models/partner-onboarding-profile"

class PartnerOnboardingProfileService extends MedusaService({
  PartnerOnboardingProfile,
}) {
  /**
   * Fetch the onboarding profile for a partner, or null if none exists yet.
   */
  async findByPartner(partnerId: string) {
    const profiles = await this.listPartnerOnboardingProfiles({
      partner_id: partnerId,
    })
    return profiles?.[0] || null
  }
}

export default PartnerOnboardingProfileService

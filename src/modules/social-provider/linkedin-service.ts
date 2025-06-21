import { MedusaError } from "@medusajs/utils"

export default class LinkedInService {
  getAuthUrl(redirectUri: string, scope: string): string {
    const clientId = process.env.LINKEDIN_CLIENT_ID
    if (!clientId || !redirectUri) {
      throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT, "LinkedInService: missing LINKEDIN_CLIENT_ID or redirect URI")
    }
    const finalScope = scope || "r_liteprofile r_emailaddress"
    return `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(finalScope)}`
  }
}

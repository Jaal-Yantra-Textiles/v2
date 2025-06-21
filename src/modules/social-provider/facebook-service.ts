import { MedusaError } from "@medusajs/utils"

export default class FacebookService {
  getAuthUrl(redirectUri: string, scope: string): string {
    const clientId = process.env.FACEBOOK_CLIENT_ID
    if (!clientId || !redirectUri) {
      throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT, "FacebookService: missing FACEBOOK_CLIENT_ID or redirect URI")
    }
    const finalScope = scope || "public_profile,email"
    return `https://www.facebook.com/v19.0/dialog/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(finalScope)}&response_type=code`
  }
}

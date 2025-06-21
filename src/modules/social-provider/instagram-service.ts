import { MedusaError } from "@medusajs/utils"

export default class InstagramService {
  getAuthUrl(redirectUri: string, scope: string): string {
    const clientId = process.env.INSTAGRAM_CLIENT_ID
    if (!clientId || !redirectUri) {
      throw new MedusaError(MedusaError.Types.INVALID_ARGUMENT, "InstagramService: missing INSTAGRAM_CLIENT_ID or redirect URI")
    }
    const finalScope = scope || "user_profile,user_media"
    return `https://api.instagram.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(finalScope)}&response_type=code`
  }
}

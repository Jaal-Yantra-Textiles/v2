import axios from "axios"
import { MedusaError } from "@medusajs/utils"
import { OAuth2Token } from "./types"

/**
 * GoogleConnectionService
 *
 * Stateless wrapper around the OAuth2 surface every Google API shares
 * (Merchant, Ads, Search Console, Business Profile). Instantiated per-call
 * with row-level credentials — no env-var singletons — because each
 * SocialPlatform row may use a different GCP OAuth client.
 *
 * Workflow steps construct an instance with the decrypted client_id /
 * client_secret from the row, call the helper they need, and discard.
 */

export type GoogleService = "merchant" | "ads" | "search-console" | "business-profile"

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

/**
 * Per-service OAuth scope map. The connect form lets the operator toggle
 * which services they want to authorize; the union of these scopes is
 * what we ask for at consent time.
 *
 * `openid email` are always added so we can capture account_email after
 * the callback.
 */
export const SCOPE_BY_SERVICE: Record<GoogleService, string> = {
  merchant: "https://www.googleapis.com/auth/content",
  ads: "https://www.googleapis.com/auth/adwords",
  "search-console": "https://www.googleapis.com/auth/webmasters",
  "business-profile": "https://www.googleapis.com/auth/business.manage",
}

const IDENTITY_SCOPES = ["openid", "email"]

export interface GoogleConnectionConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export class GoogleConnectionService {
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly redirectUri: string

  constructor(config: GoogleConnectionConfig) {
    if (!config.clientId || !config.clientSecret || !config.redirectUri) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "GoogleConnectionService: clientId, clientSecret, and redirectUri are all required"
      )
    }
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.redirectUri = config.redirectUri
  }

  /**
   * Compose the OAuth scope list from the operator's enabled services.
   * Always prepends `openid email` so we can fetch account_email.
   */
  static composeScopes(services: GoogleService[]): string[] {
    const seen = new Set<string>(IDENTITY_SCOPES)
    for (const s of services) {
      const scope = SCOPE_BY_SERVICE[s]
      if (scope) seen.add(scope)
    }
    return [...seen]
  }

  /**
   * Build the consent URL. `state` is supplied by the caller and should be
   * persisted on the platform row so the callback can verify it.
   */
  getAuthorizationUrl({
    services,
    state,
    loginHint,
  }: {
    services: GoogleService[]
    state: string
    loginHint?: string
  }): string {
    if (!services.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "At least one Google service must be enabled before generating the consent URL"
      )
    }
    const scopes = GoogleConnectionService.composeScopes(services)
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: scopes.join(" "),
      state,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    })
    if (loginHint) params.set("login_hint", loginHint)
    return `${AUTH_URL}?${params.toString()}`
  }

  async exchangeCodeForToken(code: string): Promise<OAuth2Token> {
    try {
      const response = await axios.post(
        TOKEN_URL,
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.redirectUri,
        }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      )
      return {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        token_type: response.data.token_type || "Bearer",
        expires_in: response.data.expires_in,
        scope: response.data.scope,
        retrieved_at: Date.now(),
      }
    } catch (error: any) {
      const msg =
        error.response?.data?.error_description || error.response?.data?.error || error.message
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        `Google token exchange failed: ${msg}`
      )
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuth2Token> {
    try {
      const response = await axios.post(
        TOKEN_URL,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      )
      return {
        access_token: response.data.access_token,
        refresh_token: refreshToken,
        token_type: response.data.token_type || "Bearer",
        expires_in: response.data.expires_in,
        scope: response.data.scope,
        retrieved_at: Date.now(),
      }
    } catch (error: any) {
      const msg =
        error.response?.data?.error_description || error.response?.data?.error || error.message
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        `Google token refresh failed: ${msg}`
      )
    }
  }

  async getUserInfo(
    accessToken: string
  ): Promise<{ email?: string; sub?: string; name?: string }> {
    try {
      const response = await axios.get(USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return response.data
    } catch (error: any) {
      const msg = error.response?.data?.error?.message || error.message
      throw new MedusaError(MedusaError.Types.UNAUTHORIZED, `Google userinfo failed: ${msg}`)
    }
  }
}

export default GoogleConnectionService

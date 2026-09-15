import { MedusaError } from "@medusajs/utils"
import { OAuth2Token, PinterestProviderConfig } from "./types"

interface PinterestAuthResponse {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in: number
  refresh_token_expires_in?: number
  scope?: string
}

/**
 * Pinterest OAuth 2.0 (authorization code) provider.
 *
 * Pinterest API v5:
 *  - Authorize URL:  https://www.pinterest.com/oauth/
 *  - Token endpoint: https://api.pinterest.com/v5/oauth/token
 *  - Confidential client: the token exchange sends the client_id:client_secret
 *    pair as a Basic auth header (no PKCE required, unlike Twitter).
 *
 * Credentials are read from PINTEREST_CLIENT_ID / PINTEREST_CLIENT_SECRET;
 * the redirect URI and scope are supplied per-request by the OAuth route
 * (PINTEREST_REDIRECT_URI / PINTEREST_SCOPE).
 */
export default class PinterestService {
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly redirectUri: string
  private readonly scope: string

  constructor(options?: Partial<PinterestProviderConfig>) {
    this.clientId = options?.clientId ?? process.env.PINTEREST_CLIENT_ID ?? ""
    this.clientSecret = options?.clientSecret ?? process.env.PINTEREST_CLIENT_SECRET ?? ""
    this.redirectUri = options?.redirectUri ?? process.env.PINTEREST_REDIRECT_URI ?? ""
    this.scope = options?.scope ?? process.env.PINTEREST_SCOPE ?? ""
  }

  /**
   * Return a service bound to the given credentials, falling back to the
   * current instance's (env-derived) values when a field is omitted.
   */
  withCredentials(creds: Partial<PinterestProviderConfig>): PinterestService {
    return new PinterestService({
      clientId: creds.clientId || this.clientId,
      clientSecret: creds.clientSecret || this.clientSecret,
      redirectUri: creds.redirectUri || this.redirectUri,
      scope: creds.scope || this.scope,
    })
  }

  /**
   * Build the Pinterest authorization URL.
   * `scope` is space-separated (Pinterest convention); `state` is a CSRF token.
   * Falls back to the configured row/env redirect URI and scope when the
   * route-level values are empty.
   */
  getAuthUrl(redirectUri: string, scope: string, state?: string): string {
    const resolvedRedirect = redirectUri || this.redirectUri
    if (!this.clientId || !resolvedRedirect) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "PinterestService: missing PINTEREST_CLIENT_ID or redirect URI"
      )
    }
    const finalScope =
      scope && scope.trim().length > 0
        ? scope
        : this.scope && this.scope.trim().length > 0
          ? this.scope
          : "boards:read boards:read_secret pins:read pins:read_secret user_accounts:read"

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: resolvedRedirect,
      scope: finalScope,
      response_type: "code",
    })
    if (state) params.set("state", state)

    return `https://www.pinterest.com/oauth/?${params.toString()}`
  }

  /** Start a user-auth flow, returning the URL to redirect the browser to. */
  initiateUserAuth(redirectUri: string, scope?: string): { authUrl: string; state: string } {
    const state = Math.random().toString(36).slice(2)
    const authUrl = this.getAuthUrl(redirectUri, scope || "", state)
    return { authUrl, state }
  }

  /** Exchange an authorization code for an access/refresh token. */
  async exchangeCodeForToken(code: string, redirectUri: string): Promise<OAuth2Token> {
    const resolvedRedirect = redirectUri || this.redirectUri
    if (!code || !resolvedRedirect) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "PinterestService: missing code or redirect URI"
      )
    }
    if (!this.clientId || !this.clientSecret) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "PinterestService: missing PINTEREST_CLIENT_ID or PINTEREST_CLIENT_SECRET"
      )
    }

    const authHeader = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: resolvedRedirect,
    })

    const response = await fetch("https://api.pinterest.com/v5/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Pinterest token exchange failed: ${response.status} - ${JSON.stringify(err)}`
      )
    }

    const data: PinterestAuthResponse = await response.json()
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type,
      expires_in: data.expires_in,
      scope: data.scope,
      retrieved_at: new Date(),
    }
  }

  /** Refresh an expired access token (Pinterest tokens rotate on refresh). */
  async refreshAccessToken(refreshToken: string): Promise<OAuth2Token> {
    if (!refreshToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "PinterestService: missing refresh token"
      )
    }
    if (!this.clientId || !this.clientSecret) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "PinterestService: missing PINTEREST_CLIENT_ID or PINTEREST_CLIENT_SECRET"
      )
    }

    const authHeader = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })

    const response = await fetch("https://api.pinterest.com/v5/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        `Pinterest token refresh failed: ${response.status} - ${JSON.stringify(err)}`
      )
    }

    const data: PinterestAuthResponse = await response.json()
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type,
      expires_in: data.expires_in,
      scope: data.scope,
      retrieved_at: new Date(),
    }
  }
}
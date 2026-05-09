import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../modules/socials"
import { ENCRYPTION_MODULE } from "../../../modules/encryption"
import type EncryptionService from "../../../modules/encryption/service"
import {
  GoogleConnectionService,
  type GoogleService,
} from "../../../modules/social-provider/google-connection-service"

export type ExchangeGoogleOauthCodeInput = {
  platform_id: string
  code: string
  state?: string
}

export type ExchangeGoogleOauthCodeOutput = {
  platform_id: string
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type: string
  retrieved_at: number
  account_email?: string
  account_sub?: string
  enabled_services: GoogleService[]
}

/**
 * Loads the platform, decrypts client_id/secret, exchanges the auth code for
 * tokens, and fetches the user's identity for `account_email`. Returns the
 * raw token data + identity to the persist step. State (CSRF) is verified
 * against `pending_oauth_state` saved by the init step.
 *
 * This step does NOT touch the DB beyond the read — persistence lives in
 * `persistGoogleTokensStep` so failures here don't half-write a row.
 */
export const exchangeGoogleOauthCodeStep = createStep(
  "exchange-google-oauth-code-step",
  async (input: ExchangeGoogleOauthCodeInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as any
    const encryption = container.resolve(ENCRYPTION_MODULE) as EncryptionService

    if (!input.code) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "code is required")
    }

    const [platform] = await socials.listSocialPlatforms(
      { id: input.platform_id },
      { take: 1 }
    )
    if (!platform) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `SocialPlatform ${input.platform_id} not found`
      )
    }
    if ((platform.category || "").toLowerCase() !== "google") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Platform ${platform.id} is not a Google connection`
      )
    }

    const apiConfig = (platform.api_config || {}) as Record<string, any>

    if (apiConfig.pending_oauth_state && input.state && apiConfig.pending_oauth_state !== input.state) {
      throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "OAuth state mismatch")
    }

    const clientId = apiConfig.client_id as string | undefined
    const clientSecretEnc = apiConfig.client_secret_encrypted
    const redirectUri = process.env.GOOGLE_REDIRECT_URI
    if (!clientId || !clientSecretEnc || !redirectUri) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Google connection is missing client_id, client_secret_encrypted, or GOOGLE_REDIRECT_URI"
      )
    }

    const provider = new GoogleConnectionService({
      clientId,
      clientSecret: encryption.decrypt(clientSecretEnc),
      redirectUri,
    })

    const token = await provider.exchangeCodeForToken(input.code)

    let email: string | undefined
    let sub: string | undefined
    try {
      const info = await provider.getUserInfo(token.access_token)
      email = info?.email
      sub = info?.sub
    } catch {
      // Userinfo is best-effort — `openid email` is in the scope set so this
      // shouldn't normally fail, but a transient userinfo error mustn't abort
      // the whole connect flow now that we already have a refresh token.
    }

    const enabledServices: GoogleService[] =
      (apiConfig.pending_oauth_services as GoogleService[] | undefined) ||
      (apiConfig.enabled_services as GoogleService[] | undefined) ||
      []

    return new StepResponse<ExchangeGoogleOauthCodeOutput>({
      platform_id: platform.id,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_in: token.expires_in,
      scope: token.scope,
      token_type: token.token_type,
      retrieved_at: typeof token.retrieved_at === "number" ? token.retrieved_at : Date.now(),
      account_email: email,
      account_sub: sub,
      enabled_services: enabledServices,
    })
  }
)

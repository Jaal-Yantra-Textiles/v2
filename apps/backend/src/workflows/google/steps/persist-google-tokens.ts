import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../modules/socials"
import type SocialsService from "../../../modules/socials/service"
import { encryptTokens } from "../../../modules/socials/utils/token-helpers"
import type { ExchangeGoogleOauthCodeOutput } from "./exchange-google-oauth-code"

/**
 * Persists Google OAuth tokens in the standardized SocialPlatform.api_config
 * shape (see `token-helpers.ts`):
 *
 *   access_token_encrypted, refresh_token_encrypted, expires_in,
 *   retrieved_at, scope, token_type, account_email, granted_scopes
 *
 * Plus Google-specific fields: enabled_services and account_sub.
 *
 * Clears `pending_oauth_state` and `pending_oauth_services` (set by the init
 * step). Sets the platform `status` to "active".
 */
export const persistGoogleTokensStep = createStep(
  "persist-google-tokens-step",
  async (input: ExchangeGoogleOauthCodeOutput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as SocialsService

    const [platform] = await (socials as any).listSocialPlatforms(
      { id: input.platform_id },
      { take: 1 }
    )
    if (!platform) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `SocialPlatform ${input.platform_id} not found during persist`
      )
    }

    const prevApiConfig = (platform.api_config || {}) as Record<string, any>

    const encrypted = encryptTokens(
      {
        accessToken: input.access_token,
        refreshToken: input.refresh_token || prevApiConfig.refresh_token || null,
      },
      container
    )

    const grantedScopes = (input.scope || "").split(/\s+/).filter(Boolean)

    const nextApiConfig: Record<string, any> = {
      ...prevApiConfig,
      access_token_encrypted: encrypted.access_token_encrypted,
      refresh_token_encrypted:
        encrypted.refresh_token_encrypted ?? prevApiConfig.refresh_token_encrypted,
      token_type: input.token_type,
      expires_in: input.expires_in,
      retrieved_at: new Date(input.retrieved_at).toISOString(),
      scope: input.scope,
      granted_scopes: grantedScopes,
      enabled_services: input.enabled_services,
      account_email: input.account_email ?? prevApiConfig.account_email ?? null,
      account_sub: input.account_sub ?? prevApiConfig.account_sub ?? null,
    }
    delete nextApiConfig.pending_oauth_state
    delete nextApiConfig.pending_oauth_services

    const updated = await (socials as any).updateSocialPlatforms({
      selector: { id: input.platform_id },
      data: {
        status: "active",
        api_config: nextApiConfig,
      },
    })

    return new StepResponse(Array.isArray(updated) ? updated[0] : updated)
  }
)

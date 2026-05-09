import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import { SOCIALS_MODULE } from "../../../modules/socials"
import { ENCRYPTION_MODULE } from "../../../modules/encryption"
import type EncryptionService from "../../../modules/encryption/service"
import { GoogleConnectionService } from "../../../modules/social-provider/google-connection-service"
import {
  decryptRefreshToken,
  encryptTokens,
} from "../../../modules/socials/utils/token-helpers"

export type RefreshGoogleTokenInput = {
  platform_id: string
  /** When true, skip the not-near-expiry check and force a refresh. */
  force?: boolean
}

export type RefreshGoogleTokenOutput = {
  platform_id: string
  access_token: string
  expires_at: string | null
  refreshed: boolean
}

const REFRESH_BUFFER_MS = 60_000 // refresh if <60s left

/**
 * Standardized Google token refresh — works for any category="google"
 * SocialPlatform row regardless of which services are bound to it.
 *
 * - Reads the encrypted refresh_token via the shared `decryptRefreshToken`
 *   helper (same dialect FB/X/IG already use).
 * - Uses GoogleConnectionService (per-row credentials, not env-singleton).
 * - Persists the new access_token via `encryptTokens` so downstream
 *   `decryptAccessToken` reads it the same way as every other platform.
 *
 * Returns `{ refreshed: false }` and the existing access token when the
 * stored token still has buffer headroom — saves a Google round-trip on
 * tight loops.
 */
export const refreshGoogleTokenStep = createStep(
  "refresh-google-token-step",
  async (input: RefreshGoogleTokenInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as any
    const encryption = container.resolve(ENCRYPTION_MODULE) as EncryptionService
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

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

    const apiConfig = (platform.api_config || {}) as Record<string, any>

    if (!input.force) {
      const retrievedAt = apiConfig.retrieved_at ? new Date(apiConfig.retrieved_at).getTime() : 0
      const expiresInMs = (apiConfig.expires_in || 0) * 1000
      const expiresAt = retrievedAt + expiresInMs
      if (retrievedAt && expiresAt - REFRESH_BUFFER_MS > Date.now()) {
        const stillValid = decryptCurrent(apiConfig, encryption)
        if (stillValid) {
          return new StepResponse<RefreshGoogleTokenOutput>({
            platform_id: platform.id,
            access_token: stillValid,
            expires_at: new Date(expiresAt).toISOString(),
            refreshed: false,
          })
        }
      }
    }

    const refreshToken = decryptRefreshToken(apiConfig, container)
    if (!refreshToken) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Platform ${platform.id} has no refresh_token — re-run OAuth`
      )
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

    const refreshed = await provider.refreshAccessToken(refreshToken)

    const encrypted = encryptTokens(
      { accessToken: refreshed.access_token },
      container
    )
    const now = Date.now()

    const nextApiConfig = {
      ...apiConfig,
      access_token_encrypted: encrypted.access_token_encrypted,
      // Strip any legacy plaintext that may still be on the row.
      access_token: undefined,
      token_type: refreshed.token_type,
      expires_in: refreshed.expires_in,
      retrieved_at: new Date(now).toISOString(),
      scope: refreshed.scope ?? apiConfig.scope,
    }

    await socials.updateSocialPlatforms({
      selector: { id: platform.id },
      data: { api_config: nextApiConfig },
    })

    const expiresAt = refreshed.expires_in
      ? new Date(now + refreshed.expires_in * 1000).toISOString()
      : null

    logger?.info?.(`[google] refreshed access token for platform=${platform.id}`)

    return new StepResponse<RefreshGoogleTokenOutput>({
      platform_id: platform.id,
      access_token: refreshed.access_token,
      expires_at: expiresAt,
      refreshed: true,
    })
  }
)

function decryptCurrent(
  apiConfig: Record<string, any>,
  encryption: EncryptionService
): string | null {
  if (apiConfig.access_token_encrypted) {
    try {
      return encryption.decrypt(apiConfig.access_token_encrypted)
    } catch {
      return null
    }
  }
  return apiConfig.access_token || null
}

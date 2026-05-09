import crypto from "crypto"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../modules/socials"
import { ENCRYPTION_MODULE } from "../../../modules/encryption"
import type EncryptionService from "../../../modules/encryption/service"
import {
  GoogleConnectionService,
  type GoogleService,
} from "../../../modules/social-provider/google-connection-service"

export type BuildGoogleAuthUrlInput = {
  platform_id: string
  /** Optional override — falls back to the platform row's enabled_services. */
  services?: GoogleService[]
  /** Optional login_hint passed to Google so the consent screen pre-selects an account. */
  login_hint?: string
}

export type BuildGoogleAuthUrlOutput = {
  location: string
  state: string
}

const KNOWN_SERVICES: GoogleService[] = [
  "merchant",
  "ads",
  "search-console",
  "business-profile",
]

/**
 * Loads the SocialPlatform row, decrypts the OAuth client secret, composes
 * the consent URL with the union of scopes for the operator's enabled
 * services, and persists the generated state on the row so the callback
 * can verify it.
 */
export const buildGoogleAuthUrlStep = createStep(
  "build-google-auth-url-step",
  async (input: BuildGoogleAuthUrlInput, { container }) => {
    const socials = container.resolve(SOCIALS_MODULE) as any
    const encryption = container.resolve(ENCRYPTION_MODULE) as EncryptionService

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
        `Platform ${platform.id} is not a Google connection (category=${platform.category})`
      )
    }

    const apiConfig = (platform.api_config || {}) as Record<string, any>
    const clientId = apiConfig.client_id as string | undefined
    const clientSecretEnc = apiConfig.client_secret_encrypted
    if (!clientId || !clientSecretEnc) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Platform is missing client_id / client_secret_encrypted in api_config"
      )
    }
    const clientSecret = encryption.decrypt(clientSecretEnc)

    const redirectUri = process.env.GOOGLE_REDIRECT_URI
    if (!redirectUri) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "GOOGLE_REDIRECT_URI env var is not set"
      )
    }

    const enabledServices = normalizeServices(
      input.services ?? (apiConfig.enabled_services as GoogleService[] | undefined)
    )

    const provider = new GoogleConnectionService({
      clientId,
      clientSecret,
      redirectUri,
    })

    const state = crypto.randomBytes(16).toString("hex")
    const location = provider.getAuthorizationUrl({
      services: enabledServices,
      state,
      loginHint: input.login_hint,
    })

    await socials.updateSocialPlatforms({
      id: platform.id,
      api_config: {
        ...apiConfig,
        pending_oauth_state: state,
        pending_oauth_services: enabledServices,
      },
    })

    return new StepResponse<BuildGoogleAuthUrlOutput>({ location, state })
  }
)

function normalizeServices(raw: GoogleService[] | undefined): GoogleService[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Enable at least one Google service on the platform before connecting"
    )
  }
  const allowed = new Set<GoogleService>(KNOWN_SERVICES)
  const out: GoogleService[] = []
  for (const s of raw) {
    if (allowed.has(s) && !out.includes(s)) out.push(s)
  }
  if (out.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `No valid Google services in ${JSON.stringify(raw)} — allowed: ${KNOWN_SERVICES.join(", ")}`
    )
  }
  return out
}

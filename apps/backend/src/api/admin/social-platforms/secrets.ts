/**
 * Secret handling for the admin social-platforms API.
 *
 * Three concerns, kept together because they're two halves of one contract:
 *
 *  1. `redactApiConfig` — strip every credential (plaintext AND the encrypted
 *     ciphertext blobs) out of any `api_config` before it leaves the API.
 *     A `<field>_present` boolean is added so the UI can still show a
 *     "configured" state. This is the #32A follow-up: the admin API used to
 *     echo back the raw `access_token` (and app_secret, webhook tokens, …),
 *     which is exactly the plaintext that the encryption subscriber works to
 *     keep off disk.
 *
 *  2. `isSecretRevealAllowed` — the only way a raw secret comes back is when
 *     the caller's auth identity has an ENABLED Medusa MFA factor AND they
 *     explicitly ask (`?reveal_secrets=true`). Medusa refuses to mint a
 *     session token for an MFA-enabled identity without a completed challenge
 *     (see `applyMfaRequirement_` in @medusajs/auth), so "MFA enabled for this
 *     identity" is a sound proxy for "this session passed MFA". Fails closed.
 *
 *  3. `preserveExistingSecrets` — because responses no longer carry secrets,
 *     the admin edit form can't echo them back on a blank-field save. So on
 *     update we restore any omitted/blank secret from the existing DB row,
 *     server-side. This makes redaction safe for every platform category
 *     without the UI ever needing to hold a secret.
 */
import type { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { ENCRYPTION_MODULE } from "../../../modules/encryption"
import type EncryptionService from "../../../modules/encryption/service"
import type { EncryptedData } from "../../../modules/encryption"

// Plaintext credential keys across every platform category (email, sms,
// payment, shipping, analytics, storage, crm, auth, communication/WhatsApp).
// Superset is intentional — redaction must over-strip rather than leak.
const PLAINTEXT_SECRET_FIELDS = [
  "access_token",
  "api_key",
  "api_secret",
  "auth_token",
  "refresh_token",
  "page_access_token",
  "user_access_token",
  "client_secret",
  "developer_token",
  "secret_key",
  "secret_access_key",
  "webhook_secret",
  "webhook_signing_secret",
  "app_secret",
  "webhook_verify_token",
  "password",
] as const

// Nested secret bags (OAuth1). Stripped wholesale by default.
const NESTED_SECRET_FIELDS = ["oauth1_credentials", "oauth1_app_credentials"] as const

function encKey(field: string): string {
  return `${field}_encrypted`
}

/**
 * Return a copy of `apiConfig` with all credentials stripped. Non-secret
 * config (host, phone_number_id, waba_id, cached templates, …) is preserved.
 *
 * When `reveal` is true, the raw secret is decrypted from its `*_encrypted`
 * blob (falling back to any stored plaintext) and returned in the plaintext
 * field; the ciphertext blob is dropped from the revealed copy.
 */
export function redactApiConfig(
  apiConfig: Record<string, any> | null | undefined,
  opts: { reveal?: boolean; encryptionService?: EncryptionService } = {}
): Record<string, any> | null | undefined {
  if (!apiConfig || typeof apiConfig !== "object") return apiConfig
  const { reveal = false, encryptionService } = opts
  const out: Record<string, any> = { ...apiConfig }

  for (const field of PLAINTEXT_SECRET_FIELDS) {
    const ek = encKey(field)
    const hasValue = Boolean(out[field]) || Boolean(out[ek])
    if (hasValue) out[`${field}_present`] = true

    if (reveal) {
      let revealed: string | null = null
      if (out[ek] && encryptionService) {
        try {
          revealed = encryptionService.decrypt(out[ek] as EncryptedData)
        } catch {
          revealed = null
        }
      }
      out[field] = revealed ?? (typeof out[field] === "string" ? out[field] : null)
      delete out[ek] // plaintext is enough for a revealed response
    } else {
      delete out[field]
      delete out[ek]
    }
  }

  for (const field of NESTED_SECRET_FIELDS) {
    const ek = encKey(field)
    if (out[field] || out[ek]) out[`${field}_present`] = true
    if (!reveal) {
      delete out[field]
      delete out[ek]
    }
  }

  return out
}

/** Redact a full social-platform row's `api_config` in place-ish (returns a copy). */
export function redactSocialPlatform<T extends Record<string, any>>(
  platform: T | null | undefined,
  opts: { reveal?: boolean; encryptionService?: EncryptionService } = {}
): T | null | undefined {
  if (!platform) return platform
  return { ...platform, api_config: redactApiConfig(platform.api_config, opts) }
}

/**
 * True only when the request's auth identity has an enabled MFA factor and the
 * caller explicitly requested a reveal. Fails closed on any error.
 */
export async function isSecretRevealAllowed(req: MedusaRequest): Promise<boolean> {
  const wantsReveal =
    String((req.query as any)?.reveal_secrets ?? "").toLowerCase() === "true"
  if (!wantsReveal) return false
  return mfaEnabledForRequest(req)
}

async function mfaEnabledForRequest(req: MedusaRequest): Promise<boolean> {
  try {
    const authIdentityId = (req as any).auth_context?.auth_identity_id
    if (!authIdentityId) return false
    const auth: any = req.scope.resolve(Modules.AUTH)
    const factors = await auth.listAuthMfa({
      auth_identity_id: authIdentityId,
      status: "enabled",
    })
    return Array.isArray(factors) && factors.length > 0
  } catch {
    return false // fail closed — never reveal when MFA state is unknown
  }
}

/**
 * Merge incoming `api_config` over `existing`, restoring any secret the caller
 * omitted or left blank from the existing row (both plaintext and ciphertext
 * variants, plus nested OAuth1 bags). Returns the merged config.
 *
 * Why: redacted responses no longer carry secrets, so an admin saving an
 * unrelated field (e.g. renaming the platform) sends an `api_config` with the
 * secrets missing. Without this, that save would wipe live credentials.
 */
export function preserveExistingSecrets(
  incoming: Record<string, any> | null | undefined,
  existing: Record<string, any> | null | undefined
): Record<string, any> | null | undefined {
  if (!incoming || typeof incoming !== "object") return incoming
  const prev = existing && typeof existing === "object" ? existing : {}
  const merged: Record<string, any> = { ...incoming }

  const restore = (key: string) => {
    const submitted = merged[key]
    const isBlank =
      submitted === undefined ||
      submitted === null ||
      (typeof submitted === "string" && submitted.length === 0)
    if (isBlank && prev[key] !== undefined && prev[key] !== null) {
      merged[key] = prev[key]
    }
  }

  for (const field of PLAINTEXT_SECRET_FIELDS) {
    restore(field)
    restore(encKey(field))
  }
  for (const field of NESTED_SECRET_FIELDS) {
    restore(field)
    restore(encKey(field))
  }
  // Never persist the UI-only presence hints.
  for (const k of Object.keys(merged)) {
    if (k.endsWith("_present")) delete merged[k]
  }
  return merged
}

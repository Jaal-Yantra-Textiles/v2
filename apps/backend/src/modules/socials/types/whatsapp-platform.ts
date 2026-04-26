import type { EncryptedData } from "../../encryption"

/**
 * Shape of SocialPlatform.api_config for a WhatsApp entry.
 *
 * Each SocialPlatform row with api_config.provider === "whatsapp" represents
 * one WhatsApp Business phone number. Multiple rows are allowed — the admin
 * picks a sender per conversation, and webhooks are routed by
 * `metadata.phone_number_id` in the inbound payload.
 */
export interface WhatsAppPlatformApiConfig {
  provider: "whatsapp"

  // Required
  phone_number_id: string

  // Credentials — plaintext or encrypted (encrypted preferred in prod)
  access_token?: string
  access_token_encrypted?: EncryptedData
  app_secret?: string
  app_secret_encrypted?: EncryptedData
  webhook_verify_token?: string
  webhook_verify_token_encrypted?: EncryptedData

  // Multi-number support
  /** Human-readable label shown in the admin picker, e.g. "India", "Australia". */
  label?: string
  /**
   * E.164 country codes this number is intended to service, e.g. ["+91"] for
   * India or ["+61"] for Australia. Used for auto-routing when the admin
   * doesn't explicitly pick a sender. Order doesn't matter.
   */
  country_codes?: string[]
  /** When true, this row is used as the fallback sender. At most one should be true. */
  is_default?: boolean

  // Display-only metadata (from Meta — useful for admin UI)
  display_phone_number?: string
  verified_name?: string
}

export interface ResolvedWhatsAppConfig {
  platformId: string
  phoneNumberId: string
  accessToken: string
  appSecret: string
  webhookVerifyToken: string
  label?: string
  countryCodes: string[]
}

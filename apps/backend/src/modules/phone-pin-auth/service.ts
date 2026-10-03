import { AbstractAuthModuleProvider } from "@medusajs/framework/utils"
import {
  AuthenticationInput,
  AuthenticationResponse,
  AuthIdentityProviderService,
  Logger,
} from "@medusajs/framework/types"

import { normalizePhoneE164 } from "../../lib/phone/normalize-phone"
import { verifyPin } from "./pin-hash"

export const PHONE_PIN_MAX_ATTEMPTS = 5
export const PHONE_PIN_LOCK_MINUTES = 15

const INVALID = "Invalid phone number or PIN"

type InjectedDependencies = {
  logger: Logger
}

export type PhonePinMetadata = {
  /** scrypt hash from pin-hash.ts; absent until the admin sets a PIN. */
  pin_hash?: string
  failed_attempts?: number
  locked_until?: string | null
  pin_set_at?: string
}

/**
 * Phone number + PIN login for partner admins (#2320).
 *
 * `POST /auth/partner/phone-pin { phone, pin }`. The provider identity's
 * `entity_id` is the admin's E.164 number and its `provider_metadata.pin_hash`
 * the scrypt hash of a 6-digit PIN. The identity hangs off the admin's EXISTING
 * auth identity (see sync-partner-admin-phone-identity), so Medusa issues the
 * same partner session as emailpass — `app_metadata.partner_id`.
 *
 * Login only: `register` refuses. The admin saves their phone and sets a PIN
 * from their profile while logged in. A 6-digit PIN is brute-forceable, so
 * {@link PHONE_PIN_MAX_ATTEMPTS} wrong PINs lock the number for
 * {@link PHONE_PIN_LOCK_MINUTES} minutes. Unknown number, no PIN set, wrong
 * PIN and locked all answer alike except the lock, which says to wait.
 */
class PhonePinAuthProviderService extends AbstractAuthModuleProvider {
  static identifier = "phone-pin"
  static DISPLAY_NAME = "Phone + PIN"

  protected logger_: Logger

  constructor({ logger }: InjectedDependencies, options: Record<string, unknown>) {
    // @ts-ignore — AbstractAuthModuleProvider's constructor takes the container
    super(...arguments)
    this.logger_ = logger
  }

  async authenticate(
    data: AuthenticationInput,
    authIdentityProviderService: AuthIdentityProviderService
  ): Promise<AuthenticationResponse> {
    // Only partner admins carry a phone-pin identity. Refuse other actor types
    // rather than mint them an actorless token.
    if ((data as { actor_type?: string }).actor_type !== "partner") {
      return { success: false, error: "Phone login is only available to partners" }
    }

    const body = (data.body ?? {}) as Record<string, unknown>
    const phone = normalizePhoneE164(typeof body.phone === "string" ? body.phone : null)
    const pin = typeof body.pin === "string" ? body.pin : ""
    if (!phone || !pin) {
      return { success: false, error: "Phone number and PIN are required" }
    }

    let authIdentity: any
    try {
      authIdentity = await authIdentityProviderService.retrieve({ entity_id: phone })
    } catch {
      return { success: false, error: INVALID }
    }

    const identity = (authIdentity.provider_identities ?? []).find(
      (p: any) => p.provider === PhonePinAuthProviderService.identifier && p.entity_id === phone
    )
    const meta = (identity?.provider_metadata ?? {}) as PhonePinMetadata
    if (!meta.pin_hash) {
      return { success: false, error: INVALID }
    }

    const now = Date.now()
    if (meta.locked_until && new Date(meta.locked_until).getTime() > now) {
      return {
        success: false,
        error: `Too many wrong PINs. Try again after ${PHONE_PIN_LOCK_MINUTES} minutes, or log in with your email.`,
      }
    }

    if (!(await verifyPin(pin, meta.pin_hash))) {
      const failed = (meta.failed_attempts ?? 0) + 1
      const lock = failed >= PHONE_PIN_MAX_ATTEMPTS
      await authIdentityProviderService.update(phone, {
        provider_metadata: {
          ...meta,
          failed_attempts: lock ? 0 : failed,
          locked_until: lock ? new Date(now + PHONE_PIN_LOCK_MINUTES * 60_000).toISOString() : null,
        },
      })
      if (lock) {
        this.logger_.warn(`[phone-pin] locked ${maskPhone(phone)} after ${failed} wrong PINs`)
      }
      return { success: false, error: INVALID }
    }

    if (meta.failed_attempts || meta.locked_until) {
      await authIdentityProviderService.update(phone, {
        provider_metadata: { ...meta, failed_attempts: 0, locked_until: null },
      })
    }
    return { success: true, authIdentity }
  }

  async register(): Promise<AuthenticationResponse> {
    return {
      success: false,
      error: "Phone sign-up is not available. Log in with email, then add your phone number and PIN.",
    }
  }
}

function maskPhone(phone: string) {
  return phone.length > 4 ? `${"*".repeat(phone.length - 4)}${phone.slice(-4)}` : "****"
}

export default PhonePinAuthProviderService

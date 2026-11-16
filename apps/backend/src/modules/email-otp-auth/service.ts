import { AbstractAuthModuleProvider, Modules } from "@medusajs/framework/utils"
import {
  AuthenticationInput,
  AuthenticationResponse,
  AuthIdentityProviderService,
  Logger,
} from "@medusajs/framework/types"

import {
  checkOtp,
  generateOtpCode,
  issueOtp,
  normalizeOtpEmail,
  OTP_TTL_MINUTES,
  type PendingOtp,
} from "./otp-code"

/** Emitted with the plaintext code; the subscriber emails it and drops it. */
export const EMAIL_OTP_REQUESTED_EVENT = "auth.email_otp_requested"

export type EmailOtpRequestedEvent = {
  email: string
  code: string
  expires_in_minutes: number
  actor_type: string
}

/**
 * The provider's answers, all `success: false` except a verified code. Medusa's
 * `/auth/:actor/:provider` route turns a non-success into a 401 whose message
 * is this string, so they are machine-readable codes the storefront maps to
 * copy (apps/storefront …/design-chat/lib/email-otp.ts).
 */
export const EMAIL_OTP_ERRORS = {
  CODE_SENT: "code_sent",
  INVALID_EMAIL: "invalid_email",
  INVALID_CODE: "invalid_code",
  CODE_EXPIRED: "code_expired",
  TOO_MANY_ATTEMPTS: "too_many_attempts",
  SEND_FAILED: "send_failed",
  CUSTOMERS_ONLY: "customers_only",
} as const

type InjectedDependencies = {
  logger: Logger
  [Modules.EVENT_BUS]?: { emit: (msg: any) => Promise<unknown> }
}

/**
 * Passwordless email sign-in for design-studio buyers (#2543, phase 2).
 *
 * `POST /auth/customer/email-otp`
 *
 *   1. `{ email }` — issues a 6-digit code, stores ONLY its scrypt hash (+
 *      expiry, attempt counter, issue time) on this provider identity's
 *      `provider_metadata`, emits {@link EMAIL_OTP_REQUESTED_EVENT} for the
 *      mailer, and answers `success: false, error: "code_sent"`. A first-time
 *      email gets an auth identity created here (no actor yet). Known and
 *      unknown emails answer identically — no account enumeration.
 *   2. `{ email, code }` — verifies (otp-code.ts: timing-safe, 10-minute
 *      expiry, 5 wrong guesses burn the code, single use) and returns the auth
 *      identity. Medusa then issues the usual token: an actor token when the
 *      identity already carries `app_metadata.customer_id`, else a
 *      registration (actorless) token for `/store/custom/auth/email-otp/complete`
 *      or the stock `POST /store/customers`.
 *
 * Send rate limits live in middleware (api/middlewares.ts — per email and per
 * IP), not here: the provider cannot answer 429.
 */
class EmailOtpAuthProviderService extends AbstractAuthModuleProvider {
  static identifier = "email-otp"
  static DISPLAY_NAME = "Email one-time code"

  protected logger_: Logger
  protected container_: InjectedDependencies

  constructor(container: InjectedDependencies, options: Record<string, unknown>) {
    // @ts-ignore — AbstractAuthModuleProvider's constructor takes the container
    super(...arguments)
    this.logger_ = container.logger
    this.container_ = container
  }

  async authenticate(
    data: AuthenticationInput,
    authIdentityProviderService: AuthIdentityProviderService
  ): Promise<AuthenticationResponse> {
    const actorType = (data as { actor_type?: string }).actor_type
    // Only buyers sign in this way. Partners/admins keep their own logins.
    if (actorType !== "customer") {
      return { success: false, error: EMAIL_OTP_ERRORS.CUSTOMERS_ONLY }
    }

    const body = (data.body ?? {}) as Record<string, unknown>
    const email = normalizeOtpEmail(body.email)
    if (!email) {
      return { success: false, error: EMAIL_OTP_ERRORS.INVALID_EMAIL }
    }

    const code = typeof body.code === "string" ? body.code.trim() : ""
    return code
      ? this.verifyCode(email, code, authIdentityProviderService)
      : this.sendCode(email, actorType, authIdentityProviderService)
  }

  /** Passwordless: "register" is the same two steps as signing in. */
  async register(
    data: AuthenticationInput,
    authIdentityProviderService: AuthIdentityProviderService
  ): Promise<AuthenticationResponse> {
    return this.authenticate(
      { ...data, actor_type: (data as any).actor_type ?? "customer" } as any,
      authIdentityProviderService
    )
  }

  protected async sendCode(
    email: string,
    actorType: string,
    svc: AuthIdentityProviderService
  ): Promise<AuthenticationResponse> {
    const code = generateOtpCode()
    try {
      const existing = await this.findIdentity(email, svc)
      const pending = await issueOtp(code, Date.now(), existing?.meta)
      if (existing) {
        await svc.update(email, { provider_metadata: { ...existing.meta, ...pending } })
      } else {
        try {
          await svc.create({ entity_id: email, provider_metadata: pending })
        } catch {
          // Two sends racing for a first-time email: the other one created the
          // identity — write this code onto it instead.
          await svc.update(email, { provider_metadata: pending })
        }
      }
    } catch (e: any) {
      this.logger_.error(`[email-otp] could not store a code: ${e?.message ?? e}`)
      return { success: false, error: EMAIL_OTP_ERRORS.SEND_FAILED }
    }

    try {
      const eventBus = this.container_[Modules.EVENT_BUS]
      if (!eventBus) throw new Error("event bus not available to the auth module")
      const payload: EmailOtpRequestedEvent = {
        email,
        code,
        expires_in_minutes: OTP_TTL_MINUTES,
        actor_type: actorType,
      }
      await eventBus.emit({ name: EMAIL_OTP_REQUESTED_EVENT, data: payload })
    } catch (e: any) {
      this.logger_.error(`[email-otp] could not queue the code email: ${e?.message ?? e}`)
      return { success: false, error: EMAIL_OTP_ERRORS.SEND_FAILED }
    }

    return { success: false, error: EMAIL_OTP_ERRORS.CODE_SENT }
  }

  protected async verifyCode(
    email: string,
    code: string,
    svc: AuthIdentityProviderService
  ): Promise<AuthenticationResponse> {
    const existing = await this.findIdentity(email, svc)
    if (!existing) {
      // Never sent a code to this address — same answer as a wrong code.
      return { success: false, error: EMAIL_OTP_ERRORS.INVALID_CODE }
    }

    const result = await checkOtp(existing.meta, code)
    const authIdentity = await svc.update(email, {
      provider_metadata: { ...existing.meta, ...result.next },
    })

    if (!result.ok) {
      if (result.reason === "too_many_attempts") {
        this.logger_.warn(`[email-otp] code burnt after too many wrong guesses for ${maskEmail(email)}`)
      }
      return { success: false, error: result.reason }
    }
    return { success: true, authIdentity }
  }

  protected async findIdentity(
    email: string,
    svc: AuthIdentityProviderService
  ): Promise<{ authIdentity: any; meta: PendingOtp & Record<string, unknown> } | null> {
    let authIdentity: any
    try {
      authIdentity = await svc.retrieve({ entity_id: email })
    } catch {
      return null
    }
    const identity = (authIdentity?.provider_identities ?? []).find(
      (p: any) =>
        p.provider === EmailOtpAuthProviderService.identifier && p.entity_id === email
    )
    return { authIdentity, meta: (identity?.provider_metadata ?? {}) as any }
  }
}

export function maskEmail(email: string) {
  const [user, domain] = email.split("@")
  return `${(user ?? "").slice(0, 2)}***@${domain ?? ""}`
}

export default EmailOtpAuthProviderService

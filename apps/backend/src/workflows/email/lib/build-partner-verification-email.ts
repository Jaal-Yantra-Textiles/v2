/**
 * Pure helper for the `auth.verification_requested` subscriber.
 *
 * Given the event payload emitted by Medusa's `requestVerificationWorkflow`
 * (entity_id = the email, code = the raw verification token, plus optional
 * metadata), it computes the actor-appropriate portal URL prefix and the
 * `/verify-email` deep link the recipient clicks.
 *
 * Kept pure (no container, no I/O) so the URL/actor routing is unit-testable
 * in isolation — mirrors the shape of the password-reset subscriber but split
 * out so the branching logic has direct coverage.
 */

export type VerificationRequestedEvent = {
  entity_id: string
  entity_type?: string
  code?: string
  code_provider?: string
  auth_identity_id?: string
  expires_at?: string | Date | null
  metadata?: Record<string, unknown> | null
}

export type PartnerVerificationEmail = {
  /** Recipient email address. */
  to: string
  /** Deep link the recipient opens to confirm their email. */
  verifyUrl: string
  /** Whole-number minutes until the code expires (for copy), when known. */
  expiresMinutes: number | null
  /** Resolved actor type used to pick the URL prefix. */
  actorType: string
}

const URL_PREFIX_BY_ACTOR: Record<string, string> = {
  partner: "https://partner.jaalyantra.com",
  customer: "https://cicilabel.com",
}

const ADMIN_URL_PREFIX = "https://v3.jaalyantra.com/app"

/**
 * Resolve the front-end origin for a given actor type. Partner verification is
 * the only enabled flow today, so partner is the default; the map keeps the
 * helper reusable if customer/admin verification is enabled later.
 */
export const resolveVerifyUrlPrefix = (
  actorType: string,
  overridePrefix?: string | null
): string => {
  if (overridePrefix && overridePrefix.trim().length > 0) {
    return overridePrefix.replace(/\/+$/, "")
  }
  if (actorType === "admin" || actorType === "user") {
    return ADMIN_URL_PREFIX
  }
  return URL_PREFIX_BY_ACTOR[actorType] ?? URL_PREFIX_BY_ACTOR.partner
}

const computeExpiresMinutes = (
  expiresAt: string | Date | null | undefined,
  now: number
): number | null => {
  if (!expiresAt) {
    return null
  }
  const expiresMs = new Date(expiresAt).getTime()
  if (Number.isNaN(expiresMs)) {
    return null
  }
  const diffMs = expiresMs - now
  if (diffMs <= 0) {
    return 0
  }
  return Math.round(diffMs / 60000)
}

/**
 * Build the recipient + deep link + expiry copy for a verification email.
 *
 * @param event   The `auth.verification_requested` payload.
 * @param now     Injected clock (ms) so expiry math is deterministic in tests.
 */
export const buildPartnerVerificationEmail = (
  event: VerificationRequestedEvent,
  now: number = Date.now()
): PartnerVerificationEmail => {
  const email = event.entity_id
  if (!email) {
    throw new Error(
      "verification_requested event is missing entity_id (email)"
    )
  }
  if (!event.code) {
    throw new Error(
      "verification_requested event is missing the verification code"
    )
  }

  const metadata = event.metadata ?? {}
  const actorType =
    typeof metadata.actor_type === "string" && metadata.actor_type.length > 0
      ? (metadata.actor_type as string)
      : "partner"
  const overridePrefix =
    typeof metadata.url_prefix === "string" ? (metadata.url_prefix as string) : null

  const prefix = resolveVerifyUrlPrefix(actorType, overridePrefix)

  const params = new URLSearchParams({
    code: event.code,
    email,
  })
  const verifyUrl = `${prefix}/verify-email?${params.toString()}`

  return {
    to: email,
    verifyUrl,
    expiresMinutes: computeExpiresMinutes(event.expires_at, now),
    actorType,
  }
}

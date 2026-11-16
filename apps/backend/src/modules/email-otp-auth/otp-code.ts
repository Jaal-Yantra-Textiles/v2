import { randomInt } from "crypto"

import { hashPin, verifyPin } from "../phone-pin-auth/pin-hash"

/**
 * One-time sign-in codes for the email-otp auth provider (#2543).
 *
 * Pure helpers — no container, no DB — so expiry, attempts and single use are
 * unit-testable on their own. The provider (service.ts) only stores what these
 * return on the provider identity's `provider_metadata`.
 *
 * 🔑 Only a HASH of the code is ever stored (the same salted scrypt format as
 * the partner PIN, pin-hash.ts). The plaintext exists in memory long enough to
 * be emailed.
 */

export const OTP_CODE_LENGTH = 6
export const OTP_TTL_MINUTES = 10
export const OTP_MAX_ATTEMPTS = 5

/** What the provider keeps on `provider_metadata` between send and verify. */
export type PendingOtp = {
  /** scrypt hash of the code (pin-hash.ts format). Null once used or burnt. */
  code_hash: string | null
  /** ISO time the code stops working. */
  expires_at: string | null
  /** Wrong guesses against THIS code. */
  attempts: number
  /** ISO time the code was issued. */
  created_at: string | null
  /** ISO time of the last successful sign-in with a code. */
  verified_at?: string | null
}

/** A uniformly random 6-digit code, leading zeros kept ("004817"). */
export const generateOtpCode = (): string =>
  String(randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(OTP_CODE_LENGTH, "0")

export const isOtpCodeShape = (code: unknown): code is string =>
  typeof code === "string" && /^\d{6}$/.test(code)

/** Fresh pending state for a newly issued code. Resets the attempt counter. */
export const issueOtp = async (
  code: string,
  now: number = Date.now(),
  previous?: Partial<PendingOtp> | null
): Promise<PendingOtp> => ({
  code_hash: await hashPin(code),
  expires_at: new Date(now + OTP_TTL_MINUTES * 60_000).toISOString(),
  attempts: 0,
  created_at: new Date(now).toISOString(),
  verified_at: previous?.verified_at ?? null,
})

export type OtpCheck =
  | { ok: true; next: PendingOtp }
  | {
      ok: false
      reason: "invalid_code" | "code_expired" | "too_many_attempts"
      /** Metadata to persist (attempt counted, or the code burnt). */
      next: PendingOtp
    }

/** The same state with the code removed — used up, expired or locked out. */
const burnt = (meta: PendingOtp, extra: Partial<PendingOtp> = {}): PendingOtp => ({
  ...meta,
  code_hash: null,
  expires_at: null,
  ...extra,
})

/**
 * Check `code` against the pending state. Every outcome returns the metadata
 * to write back:
 *
 *  - success burns the code (single use) and stamps `verified_at`;
 *  - an expired code is burnt;
 *  - a wrong guess counts an attempt, and the {@link OTP_MAX_ATTEMPTS}th wrong
 *    guess burns the code — the buyer must ask for a new one;
 *  - a code already burnt answers `invalid_code`, like a code never sent, so
 *    a used code is not distinguishable from a wrong one.
 *
 * Comparison is timing-safe (scrypt + timingSafeEqual in verifyPin).
 */
export const checkOtp = async (
  meta: Partial<PendingOtp> | null | undefined,
  code: string,
  now: number = Date.now()
): Promise<OtpCheck> => {
  const current: PendingOtp = {
    code_hash: meta?.code_hash ?? null,
    expires_at: meta?.expires_at ?? null,
    attempts: Number(meta?.attempts ?? 0) || 0,
    created_at: meta?.created_at ?? null,
    verified_at: meta?.verified_at ?? null,
  }

  if (!current.code_hash) {
    return { ok: false, reason: "invalid_code", next: current }
  }
  if (current.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts", next: burnt(current) }
  }
  const expiresAt = current.expires_at ? new Date(current.expires_at).getTime() : NaN
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return { ok: false, reason: "code_expired", next: burnt(current) }
  }

  const matches = isOtpCodeShape(code) && (await verifyPin(code, current.code_hash))
  if (!matches) {
    const attempts = current.attempts + 1
    if (attempts >= OTP_MAX_ATTEMPTS) {
      return { ok: false, reason: "too_many_attempts", next: burnt(current, { attempts }) }
    }
    return { ok: false, reason: "invalid_code", next: { ...current, attempts } }
  }

  return {
    ok: true,
    next: burnt(current, { attempts: 0, verified_at: new Date(now).toISOString() }),
  }
}

/** Lower-cased, trimmed; null when it does not look like an email. */
export const normalizeOtpEmail = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null
  const email = raw.trim().toLowerCase()
  if (email.length > 254) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

import jwt from "jsonwebtoken"

/**
 * How long after its expiry a partner token may still be exchanged for a new
 * one. A partner who has not opened the app for up to this long stays signed
 * in; past it they log in again.
 */
export const PARTNER_REFRESH_GRACE_DAYS = 30

const DAY_SEC = 24 * 60 * 60

export type PartnerRefreshClaims = {
  actor_id: string
  actor_type: "partner"
  auth_identity_id: string
  auth_provider?: string
  mfa_challenge_completed_at?: string | null
  exp: number
  [key: string]: unknown
}

export type VerifyRefreshResult =
  | { ok: true; claims: PartnerRefreshClaims }
  | { ok: false; message: string }

export type VerifyRefreshConfig = {
  secret?: string | null
  publicKey?: string | null
  /** `http.jwtVerifyOptions ?? http.jwtOptions`, as the framework passes it. */
  verifyOptions?: Record<string, any> | null
  /** Seconds since epoch; injectable for tests. */
  nowSec?: number
  graceDays?: number
}

/** The bearer token out of an `Authorization` header, or null. */
export function bearerFrom(header: string | string[] | undefined | null): string | null {
  const value = Array.isArray(header) ? header[0] : header
  if (!value) return null
  const m = /^\s*bearer\s+(\S+)\s*$/i.exec(value)
  return m ? m[1] : null
}

/**
 * Verify a partner JWT's SIGNATURE, deliberately ignoring its expiry, then
 * apply our own bound: it must have expired no more than
 * {@link PARTNER_REFRESH_GRACE_DAYS} ago.
 *
 * Verification mirrors the framework's `authenticate` middleware (same key —
 * public key if configured, else the secret — and the same options, with the
 * `algorithm` → `algorithms` normalisation) so a token this accepts is one
 * the framework itself signed. `ignoreExpiration` is set as an OWN property,
 * as the framework does, and only here.
 *
 * Pure: no container, no DB.
 */
export function verifyPartnerRefreshToken(
  token: string | null | undefined,
  config: VerifyRefreshConfig
): VerifyRefreshResult {
  if (!token) {
    return { ok: false, message: "Missing bearer token" }
  }
  const key = config.publicKey || config.secret
  if (!key) {
    return { ok: false, message: "JWT secret not configured" }
  }

  const options: Record<string, any> = { ...(config.verifyOptions ?? {}) }
  if (!options.algorithms && options.algorithm) {
    options.algorithms = [options.algorithm]
  }
  // Sign-only options jsonwebtoken's verify() would reject or misread.
  delete options.algorithm
  delete options.expiresIn
  delete options.notBefore
  options.ignoreExpiration = true
  options.ignoreNotBefore = false

  let decoded: any
  try {
    decoded = jwt.verify(token, key, options)
  } catch {
    return { ok: false, message: "Invalid token" }
  }
  if (!decoded || typeof decoded !== "object") {
    return { ok: false, message: "Invalid token" }
  }

  if (decoded.actor_type !== "partner") {
    return { ok: false, message: "Not a partner token" }
  }
  if (!decoded.actor_id || typeof decoded.actor_id !== "string") {
    return { ok: false, message: "Token has no partner" }
  }
  if (!decoded.auth_identity_id || typeof decoded.auth_identity_id !== "string") {
    return { ok: false, message: "Token has no auth identity" }
  }
  if (typeof decoded.exp !== "number") {
    return { ok: false, message: "Token has no expiry" }
  }

  const now = config.nowSec ?? Math.floor(Date.now() / 1000)
  const graceSec = (config.graceDays ?? PARTNER_REFRESH_GRACE_DAYS) * DAY_SEC
  if (now - decoded.exp > graceSec) {
    return { ok: false, message: "Session expired too long ago; please log in again" }
  }

  return { ok: true, claims: decoded as PartnerRefreshClaims }
}

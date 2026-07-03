import { sdk } from "./client"

/**
 * Thin wrappers around Medusa's native auth-verification routes (2.16+),
 * scoped to the partner flow. Kept framework-free so they can be reused by the
 * register hook, the resend action, and the /verify-email page.
 *
 * Never JSON.stringify the body — the Medusa JS SDK auto-serialises objects and
 * double-encoding produces a 400 (see repo gotchas).
 */

export const getTokenFromResponse = (data: unknown): string | undefined => {
  if (!data) return undefined
  if (typeof data === "string") return data
  if (typeof data === "object" && "token" in data) {
    const token = (data as any).token
    return typeof token === "string" ? token : undefined
  }
  return undefined
}

export const isVerificationRequired = (data: unknown): boolean =>
  typeof data === "object" && data != null && (data as any).verification_required === true

/**
 * Ask the backend to (re)send a verification code to the partner's email.
 * Requires the actorless bearer token returned by register/login.
 */
export const requestPartnerVerification = async (
  token: string,
  email: string
): Promise<void> => {
  await sdk.client.fetch<void>("/auth/verification/request", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: {
      entity_id: email,
      entity_type: "email",
      code_provider: "token",
      metadata: { actor_type: "partner" },
    },
  })
}

/**
 * Confirm a verification code. No auth header needed — the confirm route is
 * `allowUnauthenticated`, so this works straight from the email deep link.
 */
export const confirmPartnerVerification = async (
  code: string
): Promise<{ entity_id?: string; verified_at?: string }> => {
  return await sdk.client.fetch("/auth/verification/confirm", {
    method: "POST",
    body: { code, code_provider: "token" },
  })
}

/**
 * Re-login to mint a fresh actorless token, then request a new code.
 * Returns false when the identity is already verified (login no longer gates),
 * so the caller can nudge the user to just sign in.
 */
export const resendPartnerVerification = async (
  email: string,
  password: string
): Promise<boolean> => {
  const login = await sdk.client.fetch<any>("/auth/partner/emailpass", {
    method: "POST",
    body: { email, password },
  })
  if (!isVerificationRequired(login)) {
    return false
  }
  const token = getTokenFromResponse(login)
  if (!token) {
    throw new Error("Could not obtain a token to resend verification")
  }
  await requestPartnerVerification(token, email)
  return true
}

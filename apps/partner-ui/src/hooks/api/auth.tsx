import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import { UseMutationOptions, useMutation } from "@tanstack/react-query"
import { sdk } from "../../lib/client"
import {
  getTokenFromResponse,
  isVerificationRequired,
  resendPartnerVerification,
} from "../../lib/partner-verification"

export type SignInResult = {
  /** True when the partner's email isn't verified — login is gated (2.16+). */
  verificationRequired: boolean
  /** Echoed back so the UI can show "we emailed <email>" / resend. */
  email: string
}

export const useSignInWithEmailPass = (
  options?: UseMutationOptions<
    SignInResult,
    FetchError,
    HttpTypes.AdminSignUpWithEmailPassword
  >
) => {
  return useMutation({
    // Raw login fetch (not sdk.auth.login) so we can see `verification_required`
    // — the SDK swallows it, sets the actorless token, and returns it, which
    // would let an unverified partner "log in" then break. We only persist the
    // token when the email IS verified.
    mutationFn: async (payload) => {
      const res = await sdk.client.fetch<any>("/auth/partner/emailpass", {
        method: "POST",
        body: payload,
      })
      if (isVerificationRequired(res)) {
        return { verificationRequired: true, email: (payload as any).email }
      }
      const token = getTokenFromResponse(res)
      if (token) {
        await sdk.client.setToken(token)
      }
      return { verificationRequired: false, email: (payload as any).email }
    },
    onSuccess: async (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/**
 * Resend the verification email for an unverified partner. Re-logs-in to mint a
 * fresh actorless token, then requests a new code (see `resendPartnerVerification`).
 * Returns false when the identity is already verified (the user can just sign in).
 */
export const useResendPartnerVerification = (
  options?: UseMutationOptions<
    boolean,
    FetchError,
    { email: string; password: string }
  >
) => {
  return useMutation({
    mutationFn: ({ email, password }) =>
      resendPartnerVerification(email, password),
    ...options,
  })
}

export const useSignUpWithEmailPass = (
  options?: UseMutationOptions<
    string,
    FetchError,
    HttpTypes.AdminSignInWithEmailPassword
  >
) => {
  return useMutation({
    mutationFn: (payload) => sdk.auth.register("partner", "emailpass", payload),
    onSuccess: async (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useResetPasswordForEmailPass = (
  options?: UseMutationOptions<void, FetchError, { email: string }>
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.auth.resetPassword("partner", "emailpass", {
        identifier: payload.email,
      }),
    onSuccess: async (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

export const useLogout = (options?: UseMutationOptions<void, FetchError>) => {
  return useMutation({
    mutationFn: () => sdk.auth.logout(),
    ...options,
  })
}

export const useUpdateProviderForEmailPass = (
  token: string,
  options?: UseMutationOptions<void, FetchError, HttpTypes.AdminUpdateProvider>
) => {
  return useMutation({
    mutationFn: (payload) =>
      sdk.auth.updateProvider("partner", "emailpass", payload, token),
    onSuccess: async (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

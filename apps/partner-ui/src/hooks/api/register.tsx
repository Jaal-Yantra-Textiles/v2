import { FetchError } from "@medusajs/js-sdk"
import { UseMutationOptions, useMutation } from "@tanstack/react-query"

import { sdk } from "../../lib/client"
import {
  getTokenFromResponse,
  isVerificationRequired,
  requestPartnerVerification,
} from "../../lib/partner-verification"

export type RegisterPartnerPayload = {
  company_name: string
  handle: string
  first_name: string
  last_name: string
  email: string
  password: string
}

export type RegisterPartnerResponse = {
  partner?: Record<string, any>
  /** True when the partner must confirm their email before signing in. */
  verificationRequired: boolean
  /** Echoed back so the UI can show "we emailed <email>". */
  email: string
}

export const useRegisterPartner = (
  options?: UseMutationOptions<RegisterPartnerResponse, FetchError, RegisterPartnerPayload>
) => {
  return useMutation({
    mutationFn: async (payload) => {
      const { company_name, handle, first_name, last_name, email, password } =
        payload

      await sdk.client.fetch<void>("/auth/partner/emailpass/register", {
        method: "POST",
        body: {
          email,
          password,
        },
      })

      const loginResponse = await sdk.client.fetch<any>(
        "/auth/partner/emailpass",
        {
          method: "POST",
          body: {
            email,
            password,
          },
        }
      )

      const token = getTokenFromResponse(loginResponse)
      const verificationRequired = isVerificationRequired(loginResponse)

      // Create the partner record now. The actorless token is accepted here
      // (route allows unregistered actors); when verification is on the partner
      // still can't sign in until they confirm their email.
      const createPartnerPayload = {
        name: company_name,
        handle,
        admin: {
          email,
          first_name,
          last_name,
        },
      }

      const headers = token ? { Authorization: `Bearer ${token}` } : undefined

      const partnerResponse = await sdk.client.fetch<{ partner?: Record<string, any> }>(
        "/partners",
        {
          method: "POST",
          body: createPartnerPayload,
          headers,
        }
      )

      // If email verification is required, kick off the verification email.
      if (verificationRequired && token) {
        try {
          await requestPartnerVerification(token, email)
        } catch {
          // Non-fatal: the user can resend from the "check your email" screen.
        }
      }

      return {
        partner: partnerResponse?.partner,
        verificationRequired,
        email,
      }
    },
    onSuccess: (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

import { FetchError } from "@medusajs/js-sdk"
import { UseMutationOptions, useMutation } from "@tanstack/react-query"

import { sdk } from "../../lib/client"

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
}

const getTokenFromLoginResponse = (data: unknown) => {
  if (!data) {
    return undefined
  }

  if (typeof data === "string") {
    return data
  }

  if (typeof data === "object" && "token" in data) {
    const token = (data as any).token
    return typeof token === "string" ? token : undefined
  }

  return undefined
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

      const token = getTokenFromLoginResponse(loginResponse)

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

      return await sdk.client.fetch<RegisterPartnerResponse>("/partners", {
        method: "POST",
        body: createPartnerPayload,
        headers,
      })
    },
    onSuccess: (data, variables, context) => {
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

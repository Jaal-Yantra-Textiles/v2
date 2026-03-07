"use server"

import { getAuthHeaders } from "./cookies"

export type CreateAiAccessFeeIntentResponse = {
  clientSecret: string | null
  sessionId: string | null
  alreadyPaid: boolean
  error?: string
}

export type ConfirmAiAccessFeeResponse = {
  success: boolean
  error?: string
}

export const createAiAccessFeeIntent =
  async (): Promise<CreateAiAccessFeeIntentResponse> => {
    const authHeaders = await getAuthHeaders()
    if (!authHeaders || Object.keys(authHeaders).length === 0) {
      return { clientSecret: null, sessionId: null, alreadyPaid: false, error: "Authentication required" }
    }

    try {
      const backendUrl =
        process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? process.env.MEDUSA_BACKEND_URL

      const response = await fetch(`${backendUrl}/store/ai/access-fee`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
          "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? "",
        },
      })

      const data = await response.json()

      if (!response.ok) {
        return { clientSecret: null, sessionId: null, alreadyPaid: false, error: data?.message ?? `HTTP ${response.status}` }
      }

      if (data.already_paid) {
        return { clientSecret: null, sessionId: null, alreadyPaid: true }
      }

      return { clientSecret: data.client_secret, sessionId: data.session_id, alreadyPaid: false }
    } catch (error: any) {
      return { clientSecret: null, sessionId: null, alreadyPaid: false, error: error?.message ?? "Failed to create payment session" }
    }
  }

export const confirmAiAccessFee = async (
  sessionId: string
): Promise<ConfirmAiAccessFeeResponse> => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders || Object.keys(authHeaders).length === 0) {
    return { success: false, error: "Authentication required" }
  }

  try {
    const backendUrl =
      process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? process.env.MEDUSA_BACKEND_URL

    const response = await fetch(`${backendUrl}/store/ai/access-fee/confirm`, {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId }),
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
        "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? "",
      },
    })

    const data = await response.json()

    if (!response.ok) {
      return { success: false, error: data?.message ?? `HTTP ${response.status}` }
    }

    return { success: true }
  } catch (error: any) {
    return { success: false, error: error?.message ?? "Failed to confirm payment" }
  }
}

"use server"

import { sdk } from "@lib/config"
import { getAuthHeaders } from "./cookies"

export type GenerateTryOnInput = {
  garment_image_base64: string
  face_image_base64: string
  cloth_type: "upper_body" | "lower_body" | "dress"
  gender: "female" | "male"
}

export type GenerateTryOnResponse = {
  tryon?: { result_url: string; media_id?: string }
  error?: { code: "AUTH_REQUIRED" | "UNKNOWN"; message: string }
}

/**
 * Generates a virtual try-on image by combining a garment design with a face photo.
 *
 * NOTE: Returns errors in the response object instead of throwing them.
 * This is because Next.js Server Actions suppress error messages in production for security,
 * which would prevent the client from detecting AUTH_REQUIRED errors.
 */
export const generateTryOn = async (
  input: GenerateTryOnInput
): Promise<GenerateTryOnResponse> => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders || Object.keys(authHeaders).length === 0) {
    return {
      error: {
        code: "AUTH_REQUIRED",
        message: "Authentication required to use Virtual Try-On",
      },
    }
  }

  try {
    const data = await sdk.client.fetch<GenerateTryOnResponse>(`/store/ai/tryon`, {
      method: "POST",
      body: input,
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
    })

    return data
  } catch (error: any) {
    if (error?.status === 401 || error?.message?.includes("unauthorized")) {
      return {
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required to use Virtual Try-On",
        },
      }
    }

    console.error("Error generating try-on:", error)

    return {
      error: {
        code: "UNKNOWN",
        message: error?.message || "Failed to generate try-on. Please try again.",
      },
    }
  }
}

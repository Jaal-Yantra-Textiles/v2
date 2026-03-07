"use server"

import { getAuthHeaders } from "./cookies"

export type GenerateTryOnInput = {
  garmentFile?: File | Blob
  garmentUrl?: string
  faceFile: File | Blob
  cloth_type: "upper_body" | "lower_body" | "dress"
  gender: "female" | "male"
}

export type GenerateTryOnResponse = {
  tryon?: { result_url: string; media_id?: string }
  error?: { code: "AUTH_REQUIRED" | "PAYMENT_REQUIRED" | "UNKNOWN"; message: string }
}

async function blobToBase64DataUrl(blob: Blob, mimeType: string): Promise<string> {
  const buffer = Buffer.from(await blob.arrayBuffer())
  return `data:${mimeType};base64,${buffer.toString("base64")}`
}

export const generateTryOn = async (
  input: GenerateTryOnInput
): Promise<GenerateTryOnResponse> => {
  try {
    const authHeaders = await getAuthHeaders()
    if (!authHeaders || Object.keys(authHeaders).length === 0) {
      return {
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication required to use Virtual Try-On",
        },
      }
    }

    const faceMime = input.faceFile.type || "image/jpeg"
    const faceBase64 = await blobToBase64DataUrl(input.faceFile, faceMime)

    let garmentPayload: { garment_image_url?: string; garment_image_base64?: string }
    if (input.garmentUrl) {
      garmentPayload = { garment_image_url: input.garmentUrl }
    } else if (input.garmentFile) {
      const garmentMime = input.garmentFile.type || "image/png"
      garmentPayload = { garment_image_base64: await blobToBase64DataUrl(input.garmentFile, garmentMime) }
    } else {
      throw new Error("Either garmentFile or garmentUrl is required")
    }

    const backendUrl = process.env.MEDUSA_BACKEND_URL ?? process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL

    const response = await fetch(`${backendUrl}/store/ai/tryon`, {
      method: "POST",
      body: JSON.stringify({
        ...garmentPayload,
        face_image_base64: faceBase64,
        cloth_type: input.cloth_type,
        gender: input.gender,
      }),
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
        "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? "",
      },
    })

    if (!response.ok) {
      if (response.status === 401) {
        return { error: { code: "AUTH_REQUIRED", message: "Authentication required to use Virtual Try-On" } }
      }
      if (response.status === 402) {
        return { error: { code: "PAYMENT_REQUIRED", message: "AI features require a one-time €2 verification fee" } }
      }
      const text = await response.text()
      throw new Error(text || `HTTP ${response.status}`)
    }

    const data = await response.json() as GenerateTryOnResponse
    return data
  } catch (error: any) {
    if (error?.status === 401 || error?.message?.includes("unauthorized")) {
      return { error: { code: "AUTH_REQUIRED", message: "Authentication required to use Virtual Try-On" } }
    }

    console.error("[ai-tryon] Error:", error?.message ?? error)
    return {
      error: {
        code: "UNKNOWN",
        message: error?.message || "Failed to generate try-on. Please try again.",
      },
    }
  }
}

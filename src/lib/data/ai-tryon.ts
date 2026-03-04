"use server"

import { getAuthHeaders } from "./cookies"

export type GenerateTryOnInput = {
  garmentFile: File | Blob
  faceFile: File
  cloth_type: "upper_body" | "lower_body" | "dress"
  gender: "female" | "male"
}

export type GenerateTryOnResponse = {
  tryon?: { result_url: string; media_id?: string }
  error?: { code: "AUTH_REQUIRED" | "UNKNOWN"; message: string }
}

/**
 * Generates a virtual try-on image by combining a garment design with a face photo.
 * Sends images as multipart/form-data to avoid JSON body size limits.
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
    // Reconstruct as proper Blob/File instances on the server side.
    // When passed through a Next.js Server Action boundary, Blob/File objects are
    // serialized as binary data and may lose their instanceof type, causing
    // FormData.append(name, blob, filename) to throw "parameter 2 is not of type 'Blob'".
    const garmentBlob = new Blob([await input.garmentFile.arrayBuffer()], {
      type: input.garmentFile.type || "image/png",
    })
    const faceBlob = new File(
      [await input.faceFile.arrayBuffer()],
      input.faceFile.name ?? "face.jpg",
      { type: input.faceFile.type || "image/jpeg" }
    )

    const formData = new FormData()
    formData.append("garment_image", garmentBlob, "garment.png")
    formData.append("face_image", faceBlob, faceBlob.name)
    formData.append("cloth_type", input.cloth_type)
    formData.append("gender", input.gender)

    // Use native fetch — don't set Content-Type, let it be set automatically with multipart boundary
    const backendUrl = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? process.env.MEDUSA_BACKEND_URL
    const response = await fetch(`${backendUrl}/store/ai/tryon`, {
      method: "POST",
      body: formData,
      headers: {
        ...authHeaders,
        // Do NOT set Content-Type here — fetch sets it automatically with the correct boundary
      },
    })

    if (!response.ok) {
      const text = await response.text()
      if (response.status === 401) {
        return { error: { code: "AUTH_REQUIRED", message: "Authentication required to use Virtual Try-On" } }
      }
      throw new Error(text || `HTTP ${response.status}`)
    }

    const data = await response.json() as GenerateTryOnResponse
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

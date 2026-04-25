"use server"

import { getAuthHeaders } from "./cookies"

export type PresignUploadResponse = {
  presign?: {
    url: string
    file_key: string
    public_url: string
  }
  error?: {
    code: "AUTH_REQUIRED" | "UNKNOWN"
    message: string
  }
}

/**
 * Gets a presigned S3 upload URL for a design layer image.
 * The client then uploads directly to S3 and stores public_url in the layer src.
 *
 * Returns errors in response object (never throws) to avoid Next.js
 * production error message suppression.
 */
export const presignDesignImageUpload = async (input: {
  name: string
  type: string
  size: number
}): Promise<PresignUploadResponse> => {
  const authHeaders = await getAuthHeaders()
  if (!authHeaders || Object.keys(authHeaders).length === 0) {
    return {
      error: {
        code: "AUTH_REQUIRED",
        message: "Authentication required to upload images",
      },
    }
  }

  try {
    const backendUrl = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? process.env.MEDUSA_BACKEND_URL
    const response = await fetch(`${backendUrl}/store/uploads/presign`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    })

    if (!response.ok) {
      if (response.status === 401) {
        return { error: { code: "AUTH_REQUIRED", message: "Authentication required to upload images" } }
      }
      const text = await response.text()
      throw new Error(text || `HTTP ${response.status}`)
    }

    const data = await response.json()
    return { presign: data }
  } catch (error: any) {
    if (error?.status === 401 || error?.message?.includes("unauthorized")) {
      return { error: { code: "AUTH_REQUIRED", message: "Authentication required to upload images" } }
    }
    console.error("Error getting presigned upload URL:", error)
    return {
      error: {
        code: "UNKNOWN",
        message: error?.message || "Failed to get upload URL. Please try again.",
      },
    }
  }
}

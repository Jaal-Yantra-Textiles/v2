import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import { useMutation, UseMutationOptions } from "@tanstack/react-query"
import { backendUrl } from "../../lib/client/client"

export interface PartnerUploadResponse {
  files: HttpTypes.AdminFile[]
}

/**
 * Get the stored auth token for partner UI.
 */
function getAuthToken(): string | null {
  try {
    return localStorage.getItem("partner_ui_auth_token")
  } catch {
    return null
  }
}

/**
 * Partner file upload hook.
 * Uses native fetch instead of sdk.client.fetch to avoid issues on mobile
 * browsers where the SDK's header manipulation can cause "fetch failed" errors.
 */
export const usePartnerUpload = (
  options?: UseMutationOptions<PartnerUploadResponse, FetchError, File[]>
) => {
  return useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData()
      files.forEach((file) => form.append("files", file))

      const token = getAuthToken()
      const headers: Record<string, string> = {}
      if (token) {
        headers["Authorization"] = `Bearer ${token}`
      }
      // Do NOT set Content-Type — browser sets multipart/form-data with boundary

      const url = `${backendUrl.replace(/\/$/, "")}/partners/uploads`

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: form,
        credentials: "include",
      })

      if (!res.ok) {
        const body = await res.text().catch(() => "Upload failed")
        const err: any = new Error(body)
        err.status = res.status
        throw err
      }

      return res.json() as Promise<PartnerUploadResponse>
    },
    ...options,
  })
}

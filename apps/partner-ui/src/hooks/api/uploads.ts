import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import { useMutation, UseMutationOptions } from "@tanstack/react-query"
import { sdk, backendUrl } from "../../lib/client/client"

export interface PartnerUploadResponse {
  files: HttpTypes.AdminFile[]
}

/**
 * Partner file upload hook.
 * Uses sdk.client.fetch for auth token management.
 * Falls back to native fetch if SDK fails (mobile compatibility).
 */
export const usePartnerUpload = (
  options?: UseMutationOptions<PartnerUploadResponse, FetchError, File[]>
) => {
  return useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData()
      files.forEach((file) => form.append("files", file))

      try {
        // Try SDK fetch first — handles auth token automatically
        return await sdk.client.fetch<PartnerUploadResponse>(
          "/partners/uploads",
          {
            method: "POST",
            body: form,
            headers: {
              // Delete default content-type so browser sets multipart boundary
              "content-type": null,
            } as any,
          }
        )
      } catch (sdkError: any) {
        // If SDK fetch fails with network error, retry with native fetch
        const isNetworkError =
          sdkError?.message === "fetch failed" ||
          sdkError?.message === "Failed to fetch" ||
          sdkError?.message?.includes("network")

        if (!isNetworkError) throw sdkError

        // Native fetch fallback for mobile browsers
        const token = (sdk as any).client?.token || null
        const headers: Record<string, string> = {}
        if (token) {
          headers["Authorization"] = `Bearer ${token}`
        }

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
      }
    },
    ...options,
  })
}

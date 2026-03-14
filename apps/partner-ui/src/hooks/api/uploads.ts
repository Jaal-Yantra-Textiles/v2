import { FetchError } from "@medusajs/js-sdk"
import { HttpTypes } from "@medusajs/types"
import { useMutation, UseMutationOptions } from "@tanstack/react-query"
import { sdk } from "../../lib/client"

export interface PartnerUploadResponse {
  files: HttpTypes.AdminFile[]
}

/**
 * Partner file upload hook.
 * Mirrors the admin's sdk.admin.upload.create() but routes to /partners/uploads.
 * Builds FormData the same way the Medusa JS SDK does internally.
 */
export const usePartnerUpload = (
  options?: UseMutationOptions<PartnerUploadResponse, FetchError, File[]>
) => {
  return useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData()
      files.forEach((file) => form.append("files", file))

      return sdk.client.fetch<PartnerUploadResponse>("/partners/uploads", {
        method: "POST",
        body: form,
        headers: {
          // Must delete the default "application/json" content-type
          // so the browser sets multipart/form-data with the correct boundary.
          "content-type": null,
        } as any,
      })
    },
    ...options,
  })
}

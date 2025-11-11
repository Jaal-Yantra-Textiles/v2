import { useMutation, UseMutationOptions, useQueryClient } from "@tanstack/react-query"
import { sdk, VITE_MEDUSA_BACKEND_URL } from "../../../lib/config"
import { mediasQueryKeys } from "./use-medias"

interface UploadManagerOptions {
  existingAlbumIds?: string[]
  existingFolderId?: string
  metadata?: Record<string, any>
}

interface UploadProgress {
  id: string
  name: string
  progress: number // 0-1
  status: "queued" | "uploading" | "completed" | "error"
  message?: string
}

interface UploadMediaInput {
  file: File
  options?: UploadManagerOptions
}

interface UploadMediaResponse {
  result: any
}

/**
 * Hook for uploading a single media file with progress tracking
 * Uses the Medusa SDK pattern for authentication
 */
export const useUploadSingleMedia = (
  onProgress?: (progress: UploadProgress) => void,
  options?: UseMutationOptions<UploadMediaResponse, Error, UploadMediaInput>
) => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ file, options: uploadOptions }) => {
      const fileId = `${file.name}|${file.size}`
      
      // Notify start
      onProgress?.({
        id: fileId,
        name: file.name,
        progress: 0,
        status: "uploading",
      })

      try {
        // Small file threshold - use direct upload
        const SMALL_FILE_THRESHOLD = 5 * 1024 * 1024 // 5MB

        if (file.size <= SMALL_FILE_THRESHOLD) {
          // Use direct fetch for FormData uploads (SDK doesn't handle FormData well)
          const formData = new FormData()
          formData.append("files", file, file.name || "upload.bin")
          
          if (uploadOptions?.existingAlbumIds?.length) {
            for (const id of uploadOptions.existingAlbumIds) {
              formData.append("existingAlbumIds", id)
            }
          }

          // Use direct fetch with credentials (like use-upload-media.ts does)
          const base = VITE_MEDUSA_BACKEND_URL?.replace(/\/$/, "") || ""
          const url = `${base}/admin/medias`

          const response = await fetch(url, {
            method: "POST",
            body: formData,
            credentials: "include",
            // Don't set Content-Type - browser will set it with boundary
          })

          const data = await response.json().catch(() => ({})) as any
          
          if (!response.ok) {
            const message = (data && (data.message || data.error)) || `Upload failed with status ${response.status}`
            throw new Error(message)
          }

          // Notify completion
          onProgress?.({
            id: fileId,
            name: file.name,
            progress: 1,
            status: "completed",
          })

          return data as UploadMediaResponse
        }

        // Large file - use multipart upload
        return await uploadLargeFile(file, uploadOptions, fileId, onProgress)
      } catch (error: any) {
        onProgress?.({
          id: fileId,
          name: file.name,
          progress: 0,
          status: "error",
          message: error?.message || "Upload failed",
        })
        throw error
      }
    },
    onSuccess: (data, variables, context) => {
      // Refresh media queries
      queryClient.invalidateQueries({ queryKey: mediasQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: ["media-dictionaries"] })
      queryClient.invalidateQueries({ queryKey: ["media-folders", "list"] })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

/**
 * Upload large file using multipart upload
 */
async function uploadLargeFile(
  file: File,
  uploadOptions: UploadManagerOptions | undefined,
  fileId: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadMediaResponse> {
  const partSize = 8 * 1024 * 1024 // 8MB
  const maxPartConcurrency = 4

  // 1) Initiate multipart upload
  const initResponse = await sdk.client.fetch("/admin/medias/uploads/initiate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      existingAlbumIds: uploadOptions?.existingAlbumIds,
    }),
  }) as Response

  if (!initResponse.ok) {
    const data = await initResponse.json().catch(() => ({})) as any
    throw new Error(data?.message || "Failed to initiate upload")
  }

  const initData = await initResponse.json() as any
  const uploadId: string = initData.uploadId
  const key: string = initData.key

  // 2) Upload parts
  const totalParts = Math.ceil(file.size / partSize)
  let completed = 0
  const etags: { PartNumber: number; ETag: string }[] = []

  let partNumber = 1
  while (partNumber <= totalParts) {
    const batch: number[] = []
    for (let i = 0; i < maxPartConcurrency && partNumber <= totalParts; i++, partNumber++) {
      batch.push(partNumber)
    }

    // Get presigned URLs for this batch
    const partsResponse = await sdk.client.fetch("/admin/medias/uploads/parts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId, key, partNumbers: batch }),
    }) as Response

    if (!partsResponse.ok) {
      throw new Error("Failed to get presigned URLs")
    }

    const partsData = await partsResponse.json() as any
    const urls: { partNumber: number; url: string }[] = partsData.urls

    // Upload parts in parallel
    await Promise.all(
      urls.map(async ({ partNumber, url }) => {
        const start = (partNumber - 1) * partSize
        const end = Math.min(start + partSize, file.size)
        const blob = file.slice(start, end)

        const resp = await fetch(url, {
          method: "PUT",
          body: blob,
          mode: "cors",
          credentials: "omit",
        })

        if (!resp.ok) {
          throw new Error(`Part ${partNumber} upload failed`)
        }

        const etag = resp.headers.get("ETag") || ""
        etags.push({ PartNumber: partNumber, ETag: etag.replace(/"/g, "") })
        completed++

        // Update progress
        onProgress?.({
          id: fileId,
          name: file.name,
          progress: completed / totalParts,
          status: "uploading",
        })
      })
    )
  }

  // 3) Complete multipart upload
  const completeResponse = await sdk.client.fetch("/admin/medias/uploads/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploadId,
      key,
      parts: etags.sort((a, b) => a.PartNumber - b.PartNumber),
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      existingAlbumIds: uploadOptions?.existingAlbumIds,
      existingFolderId: uploadOptions?.existingFolderId,
      metadata: uploadOptions?.metadata,
    }),
  }) as Response

  if (!completeResponse.ok) {
    const data = await completeResponse.json().catch(() => ({})) as any
    throw new Error(data?.message || "Failed to complete upload")
  }

  const result = await completeResponse.json() as any

  // Notify completion
  onProgress?.({
    id: fileId,
    name: file.name,
    progress: 1,
    status: "completed",
  })

  return result
}

/**
 * Hook for batch uploading multiple files
 */
export const useBatchUploadMedia = (
  onProgress?: (progress: UploadProgress) => void,
  options?: UseMutationOptions<UploadMediaResponse[], Error, UploadMediaInput[]>
) => {
  const queryClient = useQueryClient()
  const uploadSingle = useUploadSingleMedia(onProgress)

  return useMutation({
    mutationFn: async (uploads: UploadMediaInput[]) => {
      const results: UploadMediaResponse[] = []

      // Upload files sequentially to avoid overwhelming the server
      for (const upload of uploads) {
        try {
          const result = await uploadSingle.mutateAsync(upload)
          results.push(result)
        } catch (error) {
          console.error(`Failed to upload ${upload.file.name}:`, error)
          // Continue with other files
        }
      }

      return results
    },
    onSuccess: (data, variables, context) => {
      queryClient.invalidateQueries({ queryKey: mediasQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: ["media-dictionaries"] })
      queryClient.invalidateQueries({ queryKey: ["media-folders", "list"] })
      options?.onSuccess?.(data, variables, context)
    },
    ...options,
  })
}

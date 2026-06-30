import { useMutation, UseMutationOptions, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../../lib/config"
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
        // All uploads go through the S3 multipart flow for consistent, clean
        // `<safeBase>-<rand>.<ext>` naming — even tiny files. S3 allows a
        // single-part multipart upload of any size, so this works uniformly.
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
    onSuccess: (data, variables, _mutateResult, context) => {
      // Refresh media queries
      queryClient.invalidateQueries({ queryKey: mediasQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: ["media"] })
      queryClient.invalidateQueries({ queryKey: ["media-dictionaries"] })
      queryClient.invalidateQueries({ queryKey: ["media-folders", "list"] })
      options?.onSuccess?.(data, variables, _mutateResult, context)
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

  // 1) Initiate multipart upload.
  // NOTE: sdk.client.fetch serializes the body itself (it JSON.stringifies any
  // body when content-type is application/json, which it defaults to) and
  // returns the *parsed* JSON, throwing on non-2xx. Passing a pre-stringified
  // string here double-encodes it into a quoted JSON string, which Express's
  // strict body parser rejects with an HTML "Bad Request" before the route runs.
  let initData: any
  try {
    initData = await sdk.client.fetch("/admin/medias/uploads/initiate", {
      method: "POST",
      body: {
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        existingAlbumIds: uploadOptions?.existingAlbumIds,
      },
    })
  } catch (e: any) {
    throw new Error(e?.message || "Failed to initiate upload")
  }
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
    let partsData: any
    try {
      partsData = await sdk.client.fetch("/admin/medias/uploads/parts", {
        method: "POST",
        body: { uploadId, key, partNumbers: batch },
      })
    } catch (e: any) {
      throw new Error(e?.message || "Failed to get presigned URLs")
    }
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
  let result: any
  try {
    result = await sdk.client.fetch("/admin/medias/uploads/complete", {
      method: "POST",
      body: {
        uploadId,
        key,
        parts: etags.sort((a, b) => a.PartNumber - b.PartNumber),
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        existingAlbumIds: uploadOptions?.existingAlbumIds,
        existingFolderId: uploadOptions?.existingFolderId,
        metadata: uploadOptions?.metadata,
      },
    })
  } catch (e: any) {
    throw new Error(e?.message || "Failed to complete upload")
  }

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
    onSuccess: (data, variables, _mutateResult, context) => {
      queryClient.invalidateQueries({ queryKey: mediasQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: ["media-dictionaries"] })
      queryClient.invalidateQueries({ queryKey: ["media-folders", "list"] })
      options?.onSuccess?.(data, variables, _mutateResult, context)
    },
    ...options,
  })
}

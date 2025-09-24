import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "@medusajs/ui"
import { UploadManager, UploadItemState } from "../../lib/uploads/upload-manager"
import { mediaFolderQueryKeys } from "./media-folders/use-media-folder"
import { mediaFolderDetailQueryKeys } from "./media-folders/use-media-folder-detail"

export type UseFolderUploadsReturn = {
  uploads: Record<string, UploadItemState>
  enqueueFiles: (files: File[], opts?: { existingAlbumIds?: string[]; metadata?: Record<string, any> }) => void
  pauseAll: () => void
  resumeAll: () => void
  manager: UploadManager
}

export function useFolderUploads(folderId: string): UseFolderUploadsReturn {
  const queryClient = useQueryClient()
  const managerRef = useRef<UploadManager>()
  if (!managerRef.current) {
    managerRef.current = new UploadManager()
  }
  const [uploads, setUploads] = useState<Record<string, UploadItemState>>({})
  const sessionIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const off = managerRef.current!.onUpdate(async (s: UploadItemState) => {
      setUploads((prev) => ({ ...prev, [s.id]: s }))
      if (sessionIdsRef.current.has(s.id)) {
        const allDone = Array.from(sessionIdsRef.current).every(
          (id) => uploads[id]?.status === "completed" || (id === s.id && s.status === "completed")
        )
        if (allDone && sessionIdsRef.current.size > 0) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: mediaFolderQueryKeys.detail(folderId) }),
            queryClient.invalidateQueries({ queryKey: mediaFolderDetailQueryKeys.detail(folderId) }),
          ])
          sessionIdsRef.current.clear()
          toast.success("Uploads completed. Gallery updated.")
        }
      }
    })
    return () => off()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId])

  const enqueueFiles = (files: File[], opts?: { existingAlbumIds?: string[]; metadata?: Record<string, any> }) => {
    for (const file of files) {
      const id = `${file.name}|${file.size}`
      sessionIdsRef.current.add(id)
      managerRef.current!.enqueue(file, { existingFolderId: folderId, existingAlbumIds: opts?.existingAlbumIds, metadata: opts?.metadata })
    }
  }

  const pauseAll = () => managerRef.current!.pauseAll()
  const resumeAll = () => managerRef.current!.resumeAll()

  return {
    uploads,
    enqueueFiles,
    pauseAll,
    resumeAll,
    manager: managerRef.current!,
  }
}

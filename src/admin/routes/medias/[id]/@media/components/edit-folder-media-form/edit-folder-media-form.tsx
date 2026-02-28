import { useState, useMemo, useEffect, useRef } from "react"
import { z } from "@medusajs/framework/zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button, CommandBar, IconButton, Text, clx, toast } from "@medusajs/ui"
import { useFieldArray, useForm } from "react-hook-form"
import { useQueryClient } from "@tanstack/react-query"
import { KeyboundForm } from "../../../../../../components/utilitites/key-bound-form"
import { RouteFocusModal } from "../../../../../../components/modal/route-focus-modal"
import { useFolderMediaViewContext } from "../folder-media-view/folder-media-view"
import { AdminMediaFolder } from "../../../../../../hooks/api/media-folders"
import { useUploadFolderMedia } from "../../../../../../hooks/api/media-folders/use-upload-folder-media"
import { mediaFolderQueryKeys } from "../../../../../../hooks/api/media-folders/use-media-folder"
import { mediaFolderDetailQueryKeys } from "../../../../../../hooks/api/media-folders/use-media-folder-detail"
import { Trash } from "@medusajs/icons"
import { UploadItemState } from "../../../../../../lib/uploads/upload-manager"
import { useFolderUploads } from "../../../../../../hooks/api/use-folder-uploads"
import { generateThumbnail, getFileIconPlaceholder, ThumbnailResult } from "../../../../../../lib/utils/thumbnail-generator"

const UploadEntrySchema = z.object({
  id: z.string().optional(),
  url: z.string().optional(),
  file: z.any(),
})

const EditFolderMediaSchema = z.object({
  uploads: z.array(UploadEntrySchema),
})

type EditFolderMediaFormType = z.infer<typeof EditFolderMediaSchema>

export const EditFolderMediaForm = ({ folder }: { folder: AdminMediaFolder }) => {
  const { goToGallery } = useFolderMediaViewContext()
  // Keep hook for backwards compat if needed, but we won't use it for large files
  const { isPending } = useUploadFolderMedia()
  const queryClient = useQueryClient()

  const form = useForm<EditFolderMediaFormType>({
    defaultValues: { uploads: [] },
    resolver: zodResolver(EditFolderMediaSchema),
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "uploads",
    keyName: "_key",
  })

  const [selection, setSelection] = useState<Record<number, true>>({})
  
  // Shared thumbnail cache to avoid regenerating thumbnails when component re-renders
  // This significantly reduces memory usage for large file selections
  const thumbnailCacheRef = useRef<Map<string, ThumbnailResult | null>>(new Map())

  // UploadManager integration via hook
  const { uploads, enqueueFiles, pauseAll, resumeAll, manager } = useFolderUploads(folder.id, {
    onAllCompleted: () => {
      // Navigate back to gallery when this session's uploads have completed and data has refreshed
      goToGallery()
    },
  })

  const handleFilesSelected: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const files = Array.from(e.target.files || [])
    files.forEach((file) => append({ file }))
    // reset input so selecting the same file again works
    e.currentTarget.value = ""
  }

  const handleSubmit = form.handleSubmit(async ({ uploads }) => {
    const files = uploads.map((u) => u.file).filter(Boolean) as File[]
    if (!files.length) {
      toast.info("Select files to upload")
      return
    }

    // Enqueue via hook (targets this folder automatically)
    enqueueFiles(files)

    toast.success(`${files.length} file(s) enqueued. Uploading...`)
    // Keep UI in place to show per-file spinners/progress; refresh data in background
    setSelection({})
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: mediaFolderQueryKeys.detail(folder.id) })
      queryClient.invalidateQueries({ queryKey: mediaFolderDetailQueryKeys.detail(folder.id) })
    }, 1000)
  })

  const selectedCount = useMemo(() => Object.keys(selection).length, [selection])

  const handleToggle = (index: number) => (checked: boolean) => {
    setSelection((prev) => {
      const next = { ...prev }
      if (!checked) delete next[index]
      else next[index] = true
      return next
    })
  }

  const handleDelete = () => {
    const indices = Object.keys(selection).map((k) => Number(k))
    const toRemove = Array.from(new Set(indices)).sort((a, b) => b - a)
    
    // Clean up thumbnail cache for removed files
    toRemove.forEach((index) => {
      const file = form.getValues(`uploads.${index}.file`) as File | undefined
      if (file) {
        const key = `${file.name}|${file.size}`
        thumbnailCacheRef.current.delete(key)
      }
    })
    
    remove(toRemove)
    setSelection({})
  }

  return (
    <RouteFocusModal.Form blockSearchParams form={form}>
      <KeyboundForm className="flex size-full flex-col overflow-hidden" onSubmit={handleSubmit}>
        <RouteFocusModal.Header>
          <div className="flex items-center justify-end w-full gap-x-2">
            <input
              type="file"
              multiple
              onChange={handleFilesSelected}
              className="hidden"
              id="folder-media-file-input"
            />
            <label htmlFor="folder-media-file-input">
              <Button asChild variant="secondary" size="small">
                <span>Select files</span>
              </Button>
            </label>
            {/* Upload controls */}
            {Object.values(uploads).some((u) => u.status === "uploading" || u.status === "queued") ? (
              <>
                <Button size="small" type="button" variant="secondary" onClick={pauseAll}>
                  Pause all
                </Button>
                <Button size="small" type="button" onClick={resumeAll}>
                  Resume all
                </Button>
              </>
            ) : null}
            {Object.values(uploads).some((u) => u.status === "error") && (
              <Button size="small" type="button" variant="secondary" onClick={() => manager.retryAllErrors()}>
                Retry failed
              </Button>
            )}
            <Button size="small" type="submit" isLoading={isPending}>
              Upload
            </Button>
            <Button variant="secondary" size="small" type="button" onClick={goToGallery} disabled={isPending}>
              Cancel
            </Button>
          </div>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex flex-col overflow-auto p-0">
          <div className="bg-ui-bg-subtle size-full overflow-auto">
            <div className="grid h-fit auto-rows-auto grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
              {fields.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-y-2 py-10 col-span-full">
                  <Text size="small" className="text-ui-fg-muted">No files selected</Text>
                  <Text size="small" className="text-ui-fg-subtle">Use Select files to choose files to upload</Text>
                </div>
              )}
              {fields.map((field, index) => (
                <UploadPreviewItem
                  key={(field as any)._key || index}
                  file={form.watch(`uploads.${index}.file`) as any}
                  selected={!!selection[index]}
                  onSelectedChange={handleToggle(index)}
                  uploads={uploads}
                  onPause={(id: string) => manager.pause(id)}
                  onResume={(id: string) => manager.resume(id)}
                  onRetry={(id: string) => manager.retry(id)}
                  thumbnailCache={thumbnailCacheRef}
                />
              ))}
            </div>
          </div>
          {/* In-session upload progress (collapsible with segmented bar) */}
          {Object.keys(uploads).length > 0 && (
            <UploadsPanel uploads={uploads} />
          )}
        </RouteFocusModal.Body>
        <CommandBar open={selectedCount > 0}>
          <CommandBar.Bar>
            <CommandBar.Value>{selectedCount} selected</CommandBar.Value>
            <CommandBar.Seperator />
            <CommandBar.Command action={handleDelete} label="Delete" shortcut="d" />
          </CommandBar.Bar>
        </CommandBar>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}

interface UploadPreviewItemProps {
  file?: File
  selected: boolean
  onSelectedChange: (v: boolean) => void
  uploads: Record<string, UploadItemState>
  onPause: (id: string) => void
  onResume: (id: string) => void
  onRetry: (id: string) => void
  // Shared thumbnail cache to avoid regenerating thumbnails
  thumbnailCache: React.MutableRefObject<Map<string, ThumbnailResult | null>>
}

const UploadPreviewItem = ({ 
  file, 
  selected, 
  onSelectedChange, 
  uploads, 
  onPause, 
  onResume, 
  onRetry,
  thumbnailCache 
}: UploadPreviewItemProps) => {
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const mountedRef = useRef(true)

  const uploadKey = useMemo(() => (file ? `${file.name}|${file.size}` : ""), [file])
  const state = uploads[uploadKey]
  const isUploading = !!state && (state.status === "queued" || state.status === "uploading")
  const isPaused = state?.status === "paused"
  const isCompleted = state?.status === "completed"
  const isError = state?.status === "error"
  const percent = Math.floor((state?.progress || 0) * 100)

  // Generate thumbnail on mount, using cache to avoid regeneration
  useEffect(() => {
    mountedRef.current = true
    
    if (!file) {
      setThumbnail(null)
      return
    }

    const key = `${file.name}|${file.size}`
    
    // Check cache first
    if (thumbnailCache.current.has(key)) {
      const cached = thumbnailCache.current.get(key)
      setThumbnail(cached?.dataUrl || getFileIconPlaceholder(file))
      return
    }

    // Generate thumbnail for image files
    if (file.type.startsWith("image/")) {
      setIsGenerating(true)
      generateThumbnail(file).then((result) => {
        if (!mountedRef.current) return
        thumbnailCache.current.set(key, result)
        setThumbnail(result?.dataUrl || getFileIconPlaceholder(file))
        setIsGenerating(false)
      })
    } else {
      // Non-image files get a placeholder
      const placeholder = getFileIconPlaceholder(file)
      thumbnailCache.current.set(key, null)
      setThumbnail(placeholder)
    }

    return () => {
      mountedRef.current = false
    }
  }, [file, thumbnailCache])

  return (
    <div className={clx("shadow-elevation-card-rest hover:shadow-elevation-card-hover focus-visible:shadow-borders-focus bg-ui-bg-subtle-hover group relative aspect-square h-auto max-w-full overflow-hidden rounded-lg outline-none", { "shadow-borders-focus": selected })}>
      {isGenerating ? (
        <div className="flex size-full items-center justify-center bg-ui-bg-subtle">
          <div className="h-6 w-6 rounded-full border-2 border-ui-fg-muted border-t-transparent animate-spin" />
        </div>
      ) : thumbnail ? (
        <img 
          src={thumbnail} 
          alt="preview" 
          className="size-full object-cover cursor-pointer" 
          onClick={() => onSelectedChange(!selected)}
          // Prevent browser from caching large decoded images
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-ui-fg-muted">No preview</div>
      )}

      {/* Per-file upload overlay */}
      {(isUploading || isPaused || isCompleted || isError) && (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
          <div className="flex items-center gap-2 text-white">
            {!isCompleted && !isPaused && !isError ? (
              <div className="h-5 w-5 rounded-full border-2 border-white/60 border-t-transparent animate-spin" />
            ) : isPaused ? (
              <div className="h-5 w-5 rounded-sm border-2 border-yellow-300/80" />
            ) : isError ? (
              <div className="h-5 w-5 rounded-full border-2 border-rose-400/80" />
            ) : (
              <div className="h-5 w-5 rounded-full border-2 border-emerald-400/80" />
            )}
            <span className="text-xs font-medium">{isCompleted ? "Done" : isPaused ? "Paused" : isError ? (state?.message || "Failed") : `${percent}%`}</span>
            {!!uploadKey && (
              isPaused ? (
                <Button size="small" variant="secondary" type="button" onClick={() => onResume(uploadKey)}>Resume</Button>
              ) : isError ? (
                <Button size="small" variant="secondary" type="button" onClick={() => onRetry(uploadKey)}>Retry</Button>
              ) : !isCompleted ? (
                <Button size="small" variant="secondary" type="button" onClick={() => onPause(uploadKey)}>Pause</Button>
              ) : null
            )}
          </div>
          {/* Bottom progress bar */}
          {!isCompleted && !isPaused && !isError && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/30">
              <div className="h-full bg-white/90 transition-all" style={{ width: `${percent}%` }} />
            </div>
          )}
        </div>
      )}

      <div className="absolute right-2 top-2 flex gap-1">
        <IconButton size="small" variant="transparent" className="text-ui-fg-muted" type="button" onClick={() => onSelectedChange(!selected)}>
          <Trash />
        </IconButton>
      </div>
    </div>
  )
}

const UploadsPanel = ({ uploads }: { uploads: Record<string, UploadItemState> }) => {
  const [open, setOpen] = useState(true)
  const items = useMemo(() => Object.values(uploads), [uploads])
  const total = items.length || 0
  const completed = items.filter((i) => i.status === "completed").length
  const errors = items.filter((i) => i.status === "error").length
  // const paused = items.filter((i) => i.status === "paused").length
  // const uploading = items.filter((i) => i.status === "uploading" || i.status === "queued").length

  // Build segmented bar: order by status for stable color blocks
  const segments = useMemo(() => {
    const ordered = [
      ...items.filter((i) => i.status === "completed"),
      ...items.filter((i) => i.status === "error"),
      ...items.filter((i) => i.status === "paused"),
      ...items.filter((i) => i.status === "uploading" || i.status === "queued"),
    ]
    return ordered.map((i) => i.status)
  }, [items])

  return (
    <div className="border-t p-3">
      <div className="flex items-center justify-between">
        <Text size="small" className="text-ui-fg-subtle">
          Uploads • {completed}/{total} done{errors ? ` • ${errors} failed` : ""}
        </Text>
        <Button size="small" variant="secondary" type="button" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {/* Segmented progress bar */}
      <div className="mt-2 h-2 w-full overflow-hidden rounded bg-ui-bg-base border border-ui-border">
        <div className="flex h-full w-full">
          {segments.map((status, idx) => (
            <div
              key={idx}
              className={clx(
                "h-full",
                status === "completed" && "bg-emerald-500",
                status === "error" && "bg-rose-500",
                status === "paused" && "bg-yellow-400",
                (status === "uploading" || status === "queued") && "bg-ui-bg-muted"
              )}
              style={{ width: `${100 / (total || 1)}%` }}
            />
          ))}
        </div>
      </div>
      {open && (
        <div className="mt-2 flex max-h-40 flex-col gap-1 overflow-auto">
          {items
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((u) => (
              <div key={u.id} className="flex items-center justify-between text-xs">
                <span className="truncate max-w-[60%]" title={u.name}>{u.name}</span>
                <span
                  className={clx(
                    "ml-2",
                    u.status === "completed" && "text-emerald-600",
                    u.status === "error" && "text-rose-600",
                    u.status === "paused" && "text-yellow-600",
                    (u.status === "uploading" || u.status === "queued") && "text-ui-fg-subtle"
                  )}
                >
                  {u.status === "completed"
                    ? "Done"
                    : u.status === "error"
                    ? u.message || "Failed"
                    : `${Math.floor((u.progress || 0) * 100)}% · ${u.status}`}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

export default EditFolderMediaForm

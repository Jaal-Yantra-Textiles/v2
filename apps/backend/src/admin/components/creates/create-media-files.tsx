import React from "react"
import { Button, Heading, Input, Select, Text, toast } from "@medusajs/ui"
import { FileUpload } from "../common/file-upload"
import { useListMediaDictionaries } from "../../hooks/api/media-folders/use-list-dictionaries"
import { RouteFocusModal } from "../modal/route-focus-modal"
import { useUploadSingleMedia } from "../../hooks/api/media-folders/use-upload-manager"

interface UploadProgress {
  id: string
  name: string
  progress: number
  status: "queued" | "uploading" | "completed" | "error"
  message?: string
}

export const CreateMediaFilesComponent: React.FC = () => {
  const [pendingFiles, setPendingFiles] = React.useState<{ file: File; url: string }[]>([])
  const [albumIdsText, setAlbumIdsText] = React.useState<string>("")
  const { data: dicts, isLoading: isDictsLoading } = useListMediaDictionaries()

  // Track live uploads for progress rendering
  const [uploads, setUploads] = React.useState<Record<string, UploadProgress>>({})
  
  // Upload hook with progress callback
  const uploadMutation = useUploadSingleMedia((progress) => {
    setUploads((prev) => ({ ...prev, [progress.id]: progress }))
  })

  React.useEffect(() => {
    return () => {
      try {
        pendingFiles.forEach((pf) => URL.revokeObjectURL(pf.url))
      } catch {}
    }
  }, [])

  return (
    <>
      <RouteFocusModal.Header>
        <Text size="small" className="text-ui-fg-subtle">
          Upload media without creating a folder. You can organize them later.
        </Text>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="flex flex-1 flex-col gap-y-4 overflow-y-auto p-4">
        <div
          className="w-full rounded-lg border-2 border-dashed border-ui-border-base bg-ui-bg-subtle hover:bg-ui-bg-base transition p-8"
        >
          <div className="mx-auto max-w-2xl text-center flex flex-col items-center gap-2">
            <Heading level="h3">Drop files here to upload</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Drag & drop files anywhere in this box, or use the selector below
            </Text>
            <div className="mt-3 w-full">
              <FileUpload
                label="Select files"
                hint="You can drag & drop or click to select multiple files"
                multiple
                onUploaded={(files) => setPendingFiles((prev) => [...prev, ...files])}
              />
            </div>
          </div>
        </div>

        {pendingFiles.length > 0 && (
          <div className="flex flex-col gap-y-2">
            <Text size="small" className="text-ui-fg-subtle">
              {pendingFiles.length} file(s) selected
            </Text>
            <div className="flex flex-wrap gap-2">
              {pendingFiles.slice(0, 12).map((f, idx) => (
                <img key={idx} src={f.url} alt={f.file.name} className="h-16 w-16 object-cover rounded" />
              ))}
            </div>
          </div>
        )}

        {/* Basic live progress (uploads within this session) */}
        {Object.keys(uploads).length > 0 && (
          <div className="flex flex-col gap-y-2">
            <Text size="small" className="text-ui-fg-subtle">In-progress uploads</Text>
            <div className="flex flex-col gap-1">
              {Object.values(uploads)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((u) => (
                  <div key={u.id} className="flex items-center justify-between text-xs">
                    <span className="truncate max-w-[60%]" title={u.name}>{u.name}</span>
                    <span className="text-ui-fg-subtle">{Math.floor((u.progress || 0) * 100)}% · {u.status}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2">
          <div>
            <Text className="font-medium">Album IDs (optional)</Text>
            <div className="mt-1">
              <Input
                placeholder="Comma-separated album IDs (e.g. alb_123, alb_456)"
                value={albumIdsText}
                onChange={(e) => setAlbumIdsText(e.target.value)}
              />
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              If provided, uploaded files will be associated with these albums.
            </Text>
          </div>
          <div>
            <Text className="font-medium">Add Album</Text>
            <div className="mt-1">
              <Select
                disabled={isDictsLoading}
                onValueChange={(val) => {
                  if (!val) return
                  const current = albumIdsText
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                  if (!current.includes(val)) {
                    const next = [...current, val].join(', ')
                    setAlbumIdsText(next)
                  }
                }}
              >
                <Select.Trigger>
                  <Select.Value placeholder={isDictsLoading ? "Loading albums..." : "Select album to add"} />
                </Select.Trigger>
                <Select.Content>
                  {((dicts?.albums ?? []) as Array<{ id: string; name: string }>).map((a) => (
                    <Select.Item key={a.id} value={a.id}>
                      {a.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
          </div>
        </div>
      </RouteFocusModal.Body>
      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button variant="secondary" type="button">
              Cancel
            </Button>
          </RouteFocusModal.Close>
          <Button
            type="button"
            disabled={pendingFiles.length === 0 || uploadMutation.isPending}
            onClick={async () => {
              try {
                const files = pendingFiles.map((p) => p.file)
                if (!files.length) {
                  toast.error("Please select file(s) to upload")
                  return
                }
                const existingAlbumIds = albumIdsText
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)

                toast.success(`Uploading ${files.length} file(s)...`)

                // Upload files sequentially
                for (const file of files) {
                  try {
                    await uploadMutation.mutateAsync({
                      file,
                      options: {
                        existingAlbumIds: existingAlbumIds.length ? existingAlbumIds : undefined,
                      }
                    })
                  } catch (error) {
                    console.error(`Failed to upload ${file.name}:`, error)
                    // Continue with other files
                  }
                }

                toast.success(`Successfully uploaded ${files.length} file(s)`)
                // Cleanup previews and selection
                pendingFiles.forEach((pf) => URL.revokeObjectURL(pf.url))
                setPendingFiles([])
                setAlbumIdsText("")
                setUploads({}) // Clear upload progress
              } catch (e: any) {
                const msg = e?.message || e?.response?.data?.message || "Failed to upload files"
                toast.error(msg)
              }
            }}
          >
            {uploadMutation.isPending ? "Uploading..." : "Upload files"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              pendingFiles.forEach((pf) => URL.revokeObjectURL(pf.url))
              setPendingFiles([])
              setAlbumIdsText("")
            }}
          >
            Clear selection
          </Button>
        </div>
      </RouteFocusModal.Footer>
    </>
  )
}

export default CreateMediaFilesComponent

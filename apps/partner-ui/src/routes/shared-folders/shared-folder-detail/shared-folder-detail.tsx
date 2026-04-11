import { useParams } from "react-router-dom"
import {
  Badge,
  Button,
  Checkbox,
  CommandBar,
  Container,
  Heading,
  Text,
  Textarea,
  Tooltip,
  clx,
  toast,
} from "@medusajs/ui"
import { ArrowDownTray, ChatBubble, ThumbnailBadge } from "@medusajs/icons"
import { useCallback, useState } from "react"
import { Outlet } from "react-router-dom"

import { SingleColumnPage } from "../../../components/layout/pages"
import {
  FileType,
  FileUpload,
} from "../../../components/common/file-upload"
import {
  usePartnerSharedFolder,
  useRegisterSharedFolderUpload,
  useSharedFolderMediaComments,
  useAddSharedFolderComment,
  type SharedFolderMediaFile,
  type MediaComment,
} from "../../../hooks/api/partner-shared-folders"
import { sdk } from "../../../lib/client/client"

const SUPPORTED_FORMATS = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]

const SUPPORTED_FORMATS_HINT =
  "JPEG, PNG, GIF, WebP, HEIC, SVG, PDF, DOC, DOCX. Max 10MB per file."

// ── Main Detail Page ──

export const SharedFolderDetail = () => {
  const { id } = useParams()
  const {
    shared_folder: folder,
    isPending,
    isError,
    error,
  } = usePartnerSharedFolder(id!)

  const [uploading, setUploading] = useState(false)
  const [selection, setSelection] = useState<Record<string, boolean>>({})
  const [expandedMediaId, setExpandedMediaId] = useState<string | null>(null)

  const registerUpload = useRegisterSharedFolderUpload(id!)

  const selectedCount = Object.keys(selection).filter(
    (k) => selection[k]
  ).length

  const handleCheckedChange = (mediaId: string) => {
    setSelection((prev) => {
      if (prev[mediaId]) {
        const { [mediaId]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [mediaId]: true }
    })
  }

  const handleFilesSelected = useCallback(
    async (files: FileType[]) => {
      if (!files.length || !id) return

      setUploading(true)
      const loading = toast.loading("Uploading files...", {
        duration: Infinity,
      })

      try {
        for (const f of files) {
          // Step 1: Initiate multipart upload
          const initRes = await sdk.client.fetch<{
            uploadId: string
            key: string
            partSize: number
          }>("/partners/medias/uploads/initiate", {
            method: "POST",
            body: {
              name: f.file.name,
              type: f.file.type,
              size: f.file.size,
            },
          })

          // Step 2: Get presigned part URLs
          const partSize = initRes.partSize || 8 * 1024 * 1024
          const totalParts = Math.ceil(f.file.size / partSize)
          const partNumbers = Array.from(
            { length: totalParts },
            (_, i) => i + 1
          )

          const partsRes = await sdk.client.fetch<{
            urls: { partNumber: number; url: string }[]
          }>("/partners/medias/uploads/parts", {
            method: "POST",
            body: {
              uploadId: initRes.uploadId,
              key: initRes.key,
              partNumbers,
            },
          })

          // Step 3: Upload each part
          const uploadedParts: { PartNumber: number; ETag: string }[] = []
          for (const { partNumber, url } of partsRes.urls) {
            const start = (partNumber - 1) * partSize
            const end = Math.min(start + partSize, f.file.size)
            const blob = f.file.slice(start, end)

            const resp = await fetch(url, { method: "PUT", body: blob })
            const etag = resp.headers.get("ETag") || ""
            uploadedParts.push({ PartNumber: partNumber, ETag: etag })
          }

          // Step 4: Complete multipart upload
          const completeRes = await sdk.client.fetch<{
            s3: { location: string; key: string }
          }>("/partners/medias/uploads/complete", {
            method: "POST",
            body: {
              uploadId: initRes.uploadId,
              key: initRes.key,
              parts: uploadedParts,
              name: f.file.name,
              type: f.file.type,
              size: f.file.size,
            },
          })

          // Step 5: Register in shared folder
          await registerUpload.mutateAsync({
            key: completeRes.s3.key,
            url: completeRes.s3.location,
            filename: f.file.name,
            mimeType: f.file.type,
            size: f.file.size,
          })
        }

        toast.success(
          `${files.length} file${files.length > 1 ? "s" : ""} uploaded`
        )
      } catch (err: any) {
        toast.error(err?.message || "Upload failed")
      } finally {
        setUploading(false)
        toast.dismiss(loading)
      }
    },
    [id, registerUpload]
  )

  if (isPending || !folder) {
    return (
      <div className="flex flex-col gap-y-4 p-4">
        <Text className="text-ui-fg-subtle">Loading...</Text>
      </div>
    )
  }

  if (isError) {
    throw error
  }

  const mediaFiles = folder.media_files || []

  return (
    <SingleColumnPage widgets={{ before: [], after: [] }} hasOutlet={true}>
      <div className="flex flex-col gap-y-4">
        {/* Header */}
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <Heading>{folder.name}</Heading>
              {folder.description && (
                <Text className="text-ui-fg-subtle" size="small">
                  {folder.description}
                </Text>
              )}
            </div>
          </div>

          <div className="px-6 py-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Path
                </Text>
                <Text className="font-mono text-xs">{folder.path}</Text>
              </div>
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Files
                </Text>
                <Text>{mediaFiles.length}</Text>
              </div>
              <div>
                <Text size="small" className="text-ui-fg-subtle">
                  Visibility
                </Text>
                <Badge
                  size="2xsmall"
                  color={folder.is_public ? "green" : "grey"}
                >
                  {folder.is_public ? "Public" : "Private"}
                </Badge>
              </div>
            </div>
          </div>
        </Container>

        {/* Upload Section */}
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Upload</Heading>
          </div>
          <div className="px-6 py-4">
            <FileUpload
              label={
                uploading ? "Uploading..." : "Drop files here or click to browse"
              }
              hint={SUPPORTED_FORMATS_HINT}
              formats={SUPPORTED_FORMATS}
              onUploaded={(uploaded, rejected) => {
                if (rejected?.length) {
                  const reasons = rejected
                    .map(
                      (r) =>
                        `${r.file.name}: ${
                          r.reason === "size" ? "too large" : "unsupported format"
                        }`
                    )
                    .join("\n")
                  toast.error(`Some files were rejected:\n${reasons}`)
                }
                if (uploaded.length) {
                  handleFilesSelected(uploaded)
                }
              }}
            />
          </div>
        </Container>

        {/* Media Grid */}
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <Heading level="h2">Files</Heading>
            {mediaFiles.length > 0 && (
              <Text size="small" className="text-ui-fg-muted">
                {mediaFiles.length} file
                {mediaFiles.length !== 1 ? "s" : ""}
              </Text>
            )}
          </div>

          {mediaFiles.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-4 px-6 py-4">
              {mediaFiles.map((media) => {
                const isSelected = !!selection[media.id]
                const isImage =
                  media.file_type === "image" ||
                  media.mime_type?.startsWith("image/")

                return (
                  <div
                    key={media.id}
                    className="shadow-elevation-card-rest hover:shadow-elevation-card-hover transition-fg group relative aspect-square size-full cursor-pointer overflow-hidden rounded-[8px]"
                  >
                    {/* Selection checkbox */}
                    <div
                      className={clx(
                        "transition-fg invisible absolute right-2 top-2 z-10 opacity-0 group-hover:visible group-hover:opacity-100",
                        { "visible opacity-100": isSelected }
                      )}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() =>
                          handleCheckedChange(media.id)
                        }
                      />
                    </div>

                    {/* Comment indicator */}
                    <button
                      onClick={() =>
                        setExpandedMediaId(
                          expandedMediaId === media.id
                            ? null
                            : media.id
                        )
                      }
                      className={clx(
                        "transition-fg invisible absolute left-2 top-2 z-10 opacity-0 group-hover:visible group-hover:opacity-100",
                        {
                          "visible opacity-100":
                            expandedMediaId === media.id,
                        }
                      )}
                    >
                      <Tooltip content="Comments">
                        <ChatBubble className="text-white drop-shadow-md" />
                      </Tooltip>
                    </button>

                    {/* Image / File type preview */}
                    {isImage ? (
                      <a
                        href={media.file_path}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src={media.file_path}
                          alt={media.original_name}
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      </a>
                    ) : (
                      <a
                        href={media.file_path}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex size-full items-center justify-center bg-ui-bg-subtle"
                      >
                        <div className="flex flex-col items-center gap-y-1 px-2">
                          <Text
                            size="xsmall"
                            weight="plus"
                            className="text-ui-fg-subtle uppercase"
                          >
                            {media.extension ||
                              media.mime_type?.split("/").pop() ||
                              media.file_type}
                          </Text>
                          <Text
                            size="xsmall"
                            className="text-ui-fg-muted truncate max-w-full"
                          >
                            {media.original_name}
                          </Text>
                        </div>
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-y-4 pb-8 pt-6">
              <div className="flex flex-col items-center">
                <Text
                  size="small"
                  leading="compact"
                  weight="plus"
                  className="text-ui-fg-subtle"
                >
                  No files uploaded yet
                </Text>
                <Text size="small" className="text-ui-fg-muted">
                  Use the upload section above to add photos and documents
                </Text>
              </div>
            </div>
          )}

          {/* Selection CommandBar */}
          <CommandBar open={selectedCount > 0}>
            <CommandBar.Bar>
              <CommandBar.Value>
                {selectedCount} selected
              </CommandBar.Value>
              <CommandBar.Seperator />
              <CommandBar.Command
                action={() => {
                  const ids = Object.keys(selection).filter(
                    (k) => selection[k]
                  )
                  ids.forEach((mediaId) => {
                    const media = mediaFiles.find(
                      (m) => m.id === mediaId
                    )
                    if (media) {
                      window.open(media.file_path, "_blank")
                    }
                  })
                }}
                label="Download"
                shortcut="d"
              />
              <CommandBar.Seperator />
              <CommandBar.Command
                action={() => setSelection({})}
                label="Clear"
                shortcut="esc"
              />
            </CommandBar.Bar>
          </CommandBar>
        </Container>

        {/* Comments Panel */}
        {expandedMediaId && (
          <MediaCommentsPanel
            folderId={id!}
            mediaId={expandedMediaId}
            mediaName={
              mediaFiles.find((m) => m.id === expandedMediaId)
                ?.original_name || "File"
            }
            onClose={() => setExpandedMediaId(null)}
          />
        )}
      </div>
      <Outlet />
    </SingleColumnPage>
  )
}

// ── Comments Panel ──

const MediaCommentsPanel = ({
  folderId,
  mediaId,
  mediaName,
  onClose,
}: {
  folderId: string
  mediaId: string
  mediaName: string
  onClose: () => void
}) => {
  const [newComment, setNewComment] = useState("")
  const { comments, isPending } = useSharedFolderMediaComments(
    folderId,
    mediaId
  )
  const addComment = useAddSharedFolderComment(folderId, mediaId)

  const handleSubmit = async () => {
    if (!newComment.trim()) return

    await addComment.mutateAsync(
      { content: newComment.trim() },
      {
        onSuccess: () => {
          toast.success("Comment added")
          setNewComment("")
        },
        onError: (err) => {
          toast.error(err.message)
        },
      }
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <Heading level="h2">Comments</Heading>
          <Text size="small" className="text-ui-fg-muted">
            on {mediaName}
          </Text>
        </div>
        <Button variant="secondary" size="small" onClick={onClose}>
          Close
        </Button>
      </div>

      {/* Add comment */}
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Textarea
          placeholder="Write a comment..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          rows={2}
        />
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="small"
            onClick={handleSubmit}
            disabled={!newComment.trim()}
            isLoading={addComment.isPending}
          >
            Add Comment
          </Button>
        </div>
      </div>

      {/* Comments list */}
      {isPending ? (
        <div className="px-6 py-6 text-center">
          <Text size="small" className="text-ui-fg-muted">
            Loading comments...
          </Text>
        </div>
      ) : comments.length === 0 ? (
        <div className="flex flex-col items-center gap-y-2 px-6 py-6">
          <ChatBubble className="text-ui-fg-muted" />
          <Text size="small" className="text-ui-fg-muted">
            No comments yet. Be the first to comment.
          </Text>
        </div>
      ) : (
        <div className="flex flex-col">
          {comments.map((comment: MediaComment) => (
            <div
              key={comment.id}
              className="flex flex-col gap-y-1 px-6 py-3 border-b border-ui-border-base last:border-b-0"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-x-2">
                  <Text size="xsmall" weight="plus">
                    {comment.author_name}
                  </Text>
                  <Badge
                    size="2xsmall"
                    color={
                      comment.author_type === "admin" ? "blue" : "green"
                    }
                  >
                    {comment.author_type}
                  </Badge>
                </div>
                {comment.created_at && (
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {new Date(comment.created_at).toLocaleDateString(
                      undefined,
                      {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }
                    )}
                  </Text>
                )}
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                {comment.content}
              </Text>
            </div>
          ))}
        </div>
      )}
    </Container>
  )
}

export const Component = SharedFolderDetail
export const Breadcrumb = () => "Folder Detail"

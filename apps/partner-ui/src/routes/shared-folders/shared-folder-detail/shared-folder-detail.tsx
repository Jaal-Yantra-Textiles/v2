import { Link, Outlet, useParams } from "react-router-dom"
import {
  Badge,
  Checkbox,
  CommandBar,
  Container,
  Heading,
  Text,
  Tooltip,
  clx,
  toast,
} from "@medusajs/ui"
import { ChatBubble } from "@medusajs/icons"
import { useCallback, useState } from "react"

import { SingleColumnPage } from "../../../components/layout/pages"
import { SingleColumnPageSkeleton } from "../../../components/common/skeleton"
import {
  FileType,
  FileUpload,
} from "../../../components/common/file-upload"
import {
  usePartnerSharedFolder,
  useRegisterSharedFolderUpload,
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
  // Videos (multipart presigned upload)
  "video/quicktime", // .mov
  "video/mp4",
  "video/webm",
  "video/x-matroska",
]

// Match the admin media flow: use multipart presigned uploads so large video
// files (e.g. .mov captures from phones) can be uploaded without a request
// body size limit. Keep this aligned with the server-side S3 provider config.
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024 // 5GB

const SUPPORTED_FORMATS_HINT =
  "JPEG, PNG, GIF, WebP, HEIC, SVG, PDF, DOC, DOCX, MOV, MP4, WebM, MKV. Max 5GB per file."

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
      const loading = toast.loading(
        `Uploading ${files.length} file${files.length > 1 ? "s" : ""}...`,
        { duration: Infinity }
      )

      // Max number of parts uploaded in parallel per file. Matches the admin
      // `use-upload-manager` hook so behaviour is consistent across surfaces.
      const MAX_PART_CONCURRENCY = 4

      try {
        for (let i = 0; i < files.length; i++) {
          const f = files[i]

          // Step 1: Initiate multipart upload
          const initRes = await sdk.client.fetch<{
            uploadId: string
            key: string
            partSize: number
          }>("/partners/medias/uploads/initiate", {
            method: "POST",
            body: {
              name: f.file.name,
              type: f.file.type || "application/octet-stream",
              size: f.file.size,
            },
          })

          const partSize = initRes.partSize || 8 * 1024 * 1024
          const totalParts = Math.max(1, Math.ceil(f.file.size / partSize))
          const uploadedParts: { PartNumber: number; ETag: string }[] = []
          let completedParts = 0

          // Step 2+3: Fetch presigned URLs in batches and upload parts in
          // parallel to keep large video uploads responsive.
          let partNumber = 1
          while (partNumber <= totalParts) {
            const batch: number[] = []
            for (
              let j = 0;
              j < MAX_PART_CONCURRENCY && partNumber <= totalParts;
              j++, partNumber++
            ) {
              batch.push(partNumber)
            }

            const partsRes = await sdk.client.fetch<{
              urls: { partNumber: number; url: string }[]
            }>("/partners/medias/uploads/parts", {
              method: "POST",
              body: {
                uploadId: initRes.uploadId,
                key: initRes.key,
                partNumbers: batch,
              },
            })

            await Promise.all(
              partsRes.urls.map(async ({ partNumber: pn, url }) => {
                const start = (pn - 1) * partSize
                const end = Math.min(start + partSize, f.file.size)
                const blob = f.file.slice(start, end)

                const resp = await fetch(url, {
                  method: "PUT",
                  body: blob,
                  mode: "cors",
                  credentials: "omit",
                })

                if (!resp.ok) {
                  throw new Error(
                    `Part ${pn} upload failed for ${f.file.name}`
                  )
                }

                // S3 returns the ETag quoted; strip quotes so the complete
                // call accepts it.
                const etag = (resp.headers.get("ETag") || "").replace(
                  /"/g,
                  ""
                )
                uploadedParts.push({ PartNumber: pn, ETag: etag })
                completedParts++

                const pct = Math.floor(
                  (completedParts / totalParts) * 100
                )
                toast.loading(
                  `Uploading ${f.file.name} (${pct}%) · ${i + 1}/${
                    files.length
                  }`,
                  { id: loading, duration: Infinity }
                )
              })
            )
          }

          // Step 4: Complete multipart upload
          const completeRes = await sdk.client.fetch<{
            s3: { location: string; key: string }
          }>("/partners/medias/uploads/complete", {
            method: "POST",
            body: {
              uploadId: initRes.uploadId,
              key: initRes.key,
              parts: uploadedParts.sort(
                (a, b) => a.PartNumber - b.PartNumber
              ),
              name: f.file.name,
              type: f.file.type || "application/octet-stream",
              size: f.file.size,
            },
          })

          // Step 5: Register in shared folder
          await registerUpload.mutateAsync({
            key: completeRes.s3.key,
            url: completeRes.s3.location,
            filename: f.file.name,
            mimeType: f.file.type || "application/octet-stream",
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
    return <SingleColumnPageSkeleton sections={3} />
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
              maxFileSize={MAX_FILE_SIZE}
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
                const isVideo =
                  media.file_type === "video" ||
                  media.mime_type?.startsWith("video/")

                return (
                  <div
                    key={media.id}
                    className="shadow-elevation-card-rest hover:shadow-elevation-card-hover transition-fg group relative aspect-square size-full overflow-hidden rounded-[8px]"
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

                    {/* Comment indicator — opens same modal as tile click */}
                    <Link
                      to={`media/${media.id}`}
                      className="transition-fg invisible absolute left-2 top-2 z-10 opacity-0 group-hover:visible group-hover:opacity-100"
                    >
                      <Tooltip content="Open & comment">
                        <ChatBubble className="text-white drop-shadow-md" />
                      </Tooltip>
                    </Link>

                    {/* Tile — navigates to the per-media modal route */}
                    <Link
                      to={`media/${media.id}`}
                      className="block size-full cursor-pointer"
                    >
                      {isImage ? (
                        <img
                          src={media.file_path}
                          alt={media.original_name}
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : isVideo ? (
                        <video
                          src={media.file_path}
                          muted
                          playsInline
                          preload="metadata"
                          className="size-full bg-black object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center bg-ui-bg-subtle">
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
                        </div>
                      )}
                    </Link>
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
      </div>
      {/* Per-media focus modal (comments panel on the right) */}
      <Outlet />
    </SingleColumnPage>
  )
}

export const Component = SharedFolderDetail
export const Breadcrumb = () => "Folder Detail"

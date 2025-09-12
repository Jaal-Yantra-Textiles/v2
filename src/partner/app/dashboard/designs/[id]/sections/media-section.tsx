"use client"

import { Container, Heading, Text, Button } from "@medusajs/ui"
import { useRef, useState } from "react"
import { useRouter } from "next/navigation"

export type Urlish =
  | string
  | {
      url?: string
      preview_url?: string
      file_url?: string
      src?: string
      name?: string
      file_name?: string
      key?: string
      isThumbnail?: boolean
    }

type UploadResponse = { files: Array<{ url: string; id?: string }> }
function isUploadResponse(obj: unknown): obj is UploadResponse {
  if (typeof obj !== "object" || obj === null) return false
  const rec = obj as Record<string, unknown>
  if (!("files" in rec)) return false
  const files = (rec as { files?: unknown }).files
  return Array.isArray(files)
}

// Inline upload form component to keep MediaSection lean
function UploadInlineForm({ designId }: { designId: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [fileCount, setFileCount] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const formEl = e.currentTarget
    const setThumbCheckedInitial = (formEl.querySelector('input[name="setThumbnail"]') as HTMLInputElement | null)?.checked ?? false
    if (!inputRef.current || !inputRef.current.files || inputRef.current.files.length === 0) {
      setError("Please select at least one file.")
      return
    }
    try {
      setSubmitting(true)
      const fd = new FormData()
      for (const f of Array.from(inputRef.current.files)) fd.append("files", f)

      // 1) Upload files via Next API proxy (carries auth token server-side)
      const uploadRes = await fetch(`/api/partner/designs/${designId}/media`, {
        method: "POST",
        body: fd,
        credentials: "include",
      })
      const uploadText = await uploadRes.text()
      if (!uploadRes.ok) {
        throw new Error(uploadText || "Failed to upload media")
      }
      const parsedUpload = JSON.parse(uploadText) as unknown
      const uploaded = isUploadResponse(parsedUpload) ? parsedUpload.files : []
      if (!uploaded || !uploaded.length) {
        throw new Error("Upload did not return any files.")
      }

      // 2) Attach URLs to the design
      const setThumb = !!setThumbCheckedInitial
      const media_files = uploaded.map((f, i) => ({ url: f.url, isThumbnail: setThumb && i === 0 }))
      const attachRes = await fetch(`/api/partner/designs/${designId}/media/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_files }),
        credentials: "include",
      })
      const attachText = await attachRes.text()
      if (!attachRes.ok) {
        throw new Error(attachText || "Failed to attach media")
      }

      // Soft refresh data without full page reload
      router.refresh()
      setFileCount(0)
      if (inputRef.current) inputRef.current.value = ""
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unexpected error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="px-4 md:px-6 pb-8">
      <Text weight="plus" className="mb-2 block">Upload Media</Text>
      <form onSubmit={handleSubmit} encType="multipart/form-data" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Hidden native file input */}
        <input
          ref={inputRef}
          type="file"
          name="files"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            const files = e.currentTarget.files
            setFileCount(files ? files.length : 0)
          }}
        />

        <div className="flex items-center gap-3">
          <Button type="button" size="small" variant="secondary" onClick={() => inputRef.current?.click()}>
            Choose files
          </Button>
          <Text size="small" className="text-ui-fg-subtle">
            {fileCount > 0 ? `${fileCount} file${fileCount > 1 ? "s" : ""} selected` : ""}
          </Text>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="setThumbnail" value="1" />
          Set first as thumbnail
        </label>

        {fileCount > 0 && (
          <Button type="submit" size="small" variant="secondary" disabled={submitting}>
            Upload & Attach
          </Button>
        )}
        {error && <Text size="small" className="text-ui-fg-error">{error}</Text>}
      </form>
    </div>
  )
}

function getUrl(item: Urlish | undefined | null): string | null {
  if (!item) return null
  if (typeof item === "string") return item
  return item.url || item.preview_url || item.file_url || item.src || null
}

function getName(item: Urlish | undefined | null, idx: number): string {
  if (!item) return `file-${idx + 1}`
  if (typeof item === "string") {
    try {
      const u = new URL(item)
      return u.pathname.split("/").pop() || `file-${idx + 1}`
    } catch {
      return `file-${idx + 1}`
    }
  }
  return item.name || item.file_name || item.key || `file-${idx + 1}`
}

export interface MediaSectionProps {
  designId: string
  thumbnailUrl?: string | null
  mediaFiles?: Urlish[] | null
  designFiles?: Urlish[] | null
}

export default function MediaSection({
  designId,
  thumbnailUrl,
  mediaFiles,
  designFiles,
}: MediaSectionProps) {
  const gallery: Urlish[] = Array.isArray(mediaFiles) ? mediaFiles : []
  const files: Urlish[] = Array.isArray(designFiles) ? designFiles : []

  // Derive thumbnail from gallery if not explicitly provided
  const derivedThumb = (() => {
    if (thumbnailUrl) return thumbnailUrl
    const found = gallery.find((m): m is Exclude<Urlish, string> => typeof m !== "string" && !!m && !!m.isThumbnail)
    return getUrl(found)
  })()

  return (
    <Container className="p-0 divide-y">
      <div className="px-4 md:px-6 py-4 flex items-center justify-between">
        <Heading level="h3">Media</Heading>
      </div>

      {/* Thumbnail */}
      <div className="px-4 md:px-6 pt-4 pb-8">
        <Text weight="plus" className="mb-2 block">Thumbnail</Text>
        {derivedThumb ? (
          <img src={derivedThumb} alt="Design thumbnail" className="w-full h-64 md:h-72 object-cover rounded border" />
        ) : (
          <div className="w-full aspect-video grid place-items-center rounded border bg-ui-bg-subtle text-ui-fg-subtle text-sm">No thumbnail</div>
        )}
      </div>

      {/* Upload */}
      <UploadInlineForm designId={designId} />

      {/* Gallery */}
      <div className="px-4 md:px-6 py-8">
        <Text weight="plus" className="mb-2 block">Gallery</Text>
        {gallery.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4 sm:gap-5 md:gap-6">
            {gallery.map((m, i) => {
              const url = getUrl(m)
              if (!url) return null
              return (
                <a key={i} href={url} target="_blank" className="block group">
                  <div className="aspect-square overflow-hidden rounded border bg-ui-bg-subtle">
                    <img src={url} alt={getName(m, i)} className="w-full h-full object-cover group-hover:opacity-90" />
                  </div>
                  <Text size="xsmall" className="truncate mt-1 block" title={getName(m, i)}>{getName(m, i)}</Text>
                </a>
              )
            })}
          </div>
        ) : (
          <Text size="small" className="text-ui-fg-subtle">No media files</Text>
        )}
      </div>

      {/* Design files */}
      <div className="px-4 md:px-6 pb-8">
        <Text weight="plus" className="mb-2 block">Design Files</Text>
        {files.length > 0 ? (
          <ul className="space-y-3 sm:space-y-2">
            {files.map((f, i) => {
              const url = getUrl(f)
              const name = getName(f, i)
              return (
                <li key={i} className="flex items-center justify-between gap-3">
                  <Text size="small" className="truncate" title={name}>{name}</Text>
                  {url ? (
                    <a href={url} target="_blank" className="text-ui-fg-interactive hover:underline text-sm">Download</a>
                  ) : (
                    <Text size="small" className="text-ui-fg-subtle">Unavailable</Text>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <Text size="small" className="text-ui-fg-subtle">No design files</Text>
        )}
      </div>
    </Container>
  )
}

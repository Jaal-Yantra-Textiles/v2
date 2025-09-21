"use client"

import { Container, Heading, Text, Button } from "@medusajs/ui"
import Image from "next/image"
import { useRef, useState } from "react"
import { useFormStatus } from "react-dom"
import { partnerUploadAndAttachDesignMediaAction } from "../../../actions"
import { uploadFileMultipart } from "../../../../../lib/multipart-upload"
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

// Inline upload form component to keep MediaSection lean
function SubmitButton({ hasFiles, pendingExternal = false }: { hasFiles: boolean; pendingExternal?: boolean }) {
  const { pending } = useFormStatus()
  const busy = pending || pendingExternal
  if (!hasFiles) return null
  return (
    <Button type="submit" size="small" variant="secondary" disabled={busy} aria-busy={busy} className="relative">
      {busy ? (
        <span className="inline-flex items-center gap-2">
          <span className="inline-block size-4 rounded-full border-2 border-transparent border-t-current animate-spin" aria-hidden="true" />
          Uploading...
        </span>
      ) : (
        "Upload & Attach"
      )}
    </Button>
  )
}

function UploadInlineForm({ designId }: { designId: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [fileCount, setFileCount] = useState(0)
  const [pendingExternal, setPendingExternal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null)

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message })
    // Auto-hide after 3 seconds
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="px-4 md:px-6 py-8">
      <Text weight="plus" className="mb-2 block">Upload Media</Text>
      <form
        action={partnerUploadAndAttachDesignMediaAction}
        encType="multipart/form-data"
        className="flex flex-wrap items-center gap-3"
        onSubmit={async (e) => {
          // Intercept when any file is larger than 7MB and use multipart upload path
          try {
            setError(null)
            const inputEl = inputRef.current
            const files = inputEl?.files
            if (!files || files.length === 0) return
            const threshold = 7 * 1024 * 1024
            const hasLarge = Array.from(files).some((f) => f.size > threshold)
            if (!hasLarge) return // let server action handle small files

            e.preventDefault()
            setPendingExternal(true)

            // Determine thumbnail checkbox
            const setThumb = !!(e.currentTarget.querySelector('input[name="setThumbnail"]') as HTMLInputElement | null)?.checked

            // Upload each file via multipart
            const uploadedUrls: string[] = []
            for (const f of Array.from(files)) {
              const completed = await uploadFileMultipart(f)
              const url = completed?.s3?.location
              if (!url) throw new Error("Multipart upload did not return a URL")
              uploadedUrls.push(url)
            }

            // Attach via Next proxy (server will add bearer)
            const media_files = uploadedUrls.map((url, idx) => ({ url, isThumbnail: setThumb && idx === 0 }))
            const attachRes = await fetch(`/api/partner/designs/${designId}/media/attach`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ media_files }),
            })
            if (!attachRes.ok) {
              throw new Error((await attachRes.text()) || "Failed to attach media")
            }

            // Refresh page to show new media
            router.refresh()
            setFileCount(0)
            if (inputRef.current) inputRef.current.value = ""
            showToast("success", `${uploadedUrls.length} file${uploadedUrls.length > 1 ? "s" : ""} uploaded successfully`)
          } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Unexpected error during multipart upload")
            showToast("error", err instanceof Error ? err.message : "Unexpected error during multipart upload")
          } finally {
            setPendingExternal(false)
          }
        }}
      >
        <input type="hidden" name="designId" value={designId} />
        {/* Hidden native file input */}
        <input
          ref={inputRef}
          type="file"
          name="files"
          multiple
          accept="image/*,video/*"
          className="hidden"
          // disabled handled by submit pending state is not required for file input
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

        <SubmitButton hasFiles={fileCount > 0} pendingExternal={pendingExternal} />
        {error && <Text size="small" className="text-ui-fg-error">{error}</Text>}
      </form>
      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 min-w-[240px] max-w-sm rounded-md border px-4 py-3 shadow-lg ${
            toast.type === "success" ? "bg-green-50 border-green-200 text-green-900" : "bg-red-50 border-red-200 text-red-900"
          }`}
        >
          <Text weight="plus" className="block mb-1">
            {toast.type === "success" ? "Success" : "Error"}
          </Text>
          <Text size="small" className="block">
            {toast.message}
          </Text>
        </div>
      )}
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
          <div className="w-full h-64 md:h-72 relative rounded border overflow-hidden">
            <Image
              src={derivedThumb}
              alt="Design thumbnail"
              fill
              sizes="(max-width: 768px) 100vw, 60vw"
              className="object-cover"
              priority
            />
          </div>
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
                  <div className="aspect-square relative overflow-hidden rounded border bg-ui-bg-subtle">
                    <Image
                      src={url}
                      alt={getName(m, i)}
                      fill
                      sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
                      className="object-cover group-hover:opacity-90"
                    />
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
      <div className="px-4 md:px-6 py-8">
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

"use client"

import { Container, Heading, Text } from "@medusajs/ui"

export type Urlish = string | { url?: string; preview_url?: string; file_url?: string; src?: string; name?: string; file_name?: string; key?: string }

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
  thumbnailUrl?: string | null
  mediaFiles?: Urlish[] | null
  designFiles?: Urlish[] | null
}

export default function MediaSection({
  thumbnailUrl,
  mediaFiles,
  designFiles,
}: MediaSectionProps) {
  const gallery: Urlish[] = Array.isArray(mediaFiles) ? mediaFiles : []
  const files: Urlish[] = Array.isArray(designFiles) ? designFiles : []

  return (
    <Container className="p-0 divide-y">
      <div className="px-6 py-4 flex items-center justify-between">
        <Heading level="h3">Media</Heading>
      </div>

      {/* Thumbnail */}
      <div className="px-6 pt-4">
        <Text weight="plus" className="mb-2 block">Thumbnail</Text>
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="Design thumbnail" className="w-full h-auto rounded border" />
        ) : (
          <div className="w-full aspect-video grid place-items-center rounded border bg-ui-bg-subtle text-ui-fg-subtle text-sm">No thumbnail</div>
        )}
      </div>

      {/* Gallery */}
      <div className="px-6 py-4">
        <Text weight="plus" className="mb-2 block">Gallery</Text>
        {gallery.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
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
      <div className="px-6 pb-4">
        <Text weight="plus" className="mb-2 block">Design Files</Text>
        {files.length > 0 ? (
          <ul className="space-y-2">
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

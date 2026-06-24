/**
 * Extract image URL(s) from a raw-material (or inventory) `media` JSON blob,
 * which has been persisted in several shapes over time:
 *
 *  - `{ files: ["https://…", …] }`              (canonical — admin form + bulk-import route)
 *  - `{ files: [{ url: "…" }, …] }`             (object entries)
 *  - `["https://…", …]`                          (raw array of urls)
 *  - `[{ url|file_path|thumbnail|src: "…" }, …]` (raw array of objects)
 *  - `{ url|file_path|thumbnail|src: "…" }`       (single object)
 *
 * Mirrors the admin helper (apps/backend/src/admin/lib/utils/first-media-url.ts)
 * so the partner UI doesn't drift. The partner side previously only handled raw
 * strings + `{ url }` objects, so the canonical `{ files: [...] }` prod shape
 * returned null → blank thumbnails in the design→inventory linking flow.
 */

const URL_KEYS = ["url", "file_path", "thumbnail", "src"] as const

function coerceUrl(entry: unknown): string | undefined {
  if (typeof entry === "string") {
    const trimmed = entry.trim()
    return trimmed.length ? trimmed : undefined
  }

  if (entry && typeof entry === "object") {
    for (const key of URL_KEYS) {
      const value = (entry as Record<string, unknown>)[key]
      if (typeof value === "string" && value.trim().length) {
        return value.trim()
      }
    }
  }

  return undefined
}

/** Unwrap `{ files: [...] }` to the inner array; otherwise return as-is. */
function unwrapFiles(media: unknown): unknown {
  if (
    media &&
    typeof media === "object" &&
    !Array.isArray(media) &&
    Array.isArray((media as { files?: unknown }).files)
  ) {
    return (media as { files: unknown[] }).files
  }
  return media
}

/**
 * Return every usable image URL from a single `media` blob, in order.
 * Empty/whitespace entries are skipped; returns `[]` when none.
 */
export function mediaUrls(media: unknown): string[] {
  if (!media) {
    return []
  }

  const candidate = unwrapFiles(media)

  if (Array.isArray(candidate)) {
    const urls: string[] = []
    for (const entry of candidate) {
      const url = coerceUrl(entry)
      if (url) {
        urls.push(url)
      }
    }
    return urls
  }

  const single = coerceUrl(candidate)
  return single ? [single] : []
}

/**
 * Return the first usable image URL from a `media` blob, or `undefined` when
 * there is no usable image (so callers can render a graceful placeholder).
 */
export function firstMediaUrl(media: unknown): string | undefined {
  return mediaUrls(media)[0]
}

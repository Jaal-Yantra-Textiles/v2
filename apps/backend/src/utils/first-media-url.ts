/**
 * Extract the first usable image URL from a raw-material (or inventory) `media`
 * JSON blob, which has been persisted in several shapes over time:
 *
 *  - `{ files: ["https://…", …] }`              (canonical — admin form + bulk-import route)
 *  - `{ files: [{ url: "…" }, …] }`             (object entries)
 *  - `["https://…", …]`                          (raw array of urls)
 *  - `[{ url|file_path|thumbnail|src: "…" }, …]` (raw array of objects)
 *  - `{ url|file_path|thumbnail|src: "…" }`       (single object)
 *
 * Returns the first non-empty string URL found, or `undefined` when there is no
 * usable image (so callers can render a graceful placeholder / skip the patch).
 *
 * Kept in sync with `apps/backend/src/admin/lib/utils/first-media-url.ts` — the
 * admin (Vite) build can't import from the backend build and vice-versa, so the
 * two intentionally mirror each other.
 */
export function firstMediaUrl(media: unknown): string | undefined {
  if (!media) {
    return undefined
  }

  // Unwrap `{ files: [...] }`
  let candidate: unknown = media
  if (
    typeof media === "object" &&
    !Array.isArray(media) &&
    Array.isArray((media as { files?: unknown }).files)
  ) {
    candidate = (media as { files: unknown[] }).files
  }

  if (Array.isArray(candidate)) {
    for (const entry of candidate) {
      const url = coerceUrl(entry)
      if (url) {
        return url
      }
    }
    return undefined
  }

  return coerceUrl(candidate)
}

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

// Shared derivation of "the one image that stands for this design".
//
// A design carries pictures in three places and no single column names the
// canonical one:
//   • `media_files` — the uploaded gallery; an entry may be flagged
//     `isThumbnail` by the media editor.
//   • `metadata.thumbnail` — the denormalised copy the media form writes when a
//     thumbnail is picked (kept in sync by the admin edit-media form).
//   • `moodboard` — an Excalidraw scene whose image elements reference
//     `files[fileId].dataURL`; for generated tech-pack scenes that dataURL is a
//     plain URL (see build-moodboard-scene), not base64.
//
// Order of preference: an explicitly flagged media file → the denormalised
// metadata thumbnail → the first media file → the moodboard's first reference
// image. Callers that render a LIST (order tables, design tables) pass
// `allowDataUrl: false` so a base64-inlined moodboard image can never bloat a
// list payload; a detail surface that already loaded the scene can allow it.

export type DesignMediaFile = {
  id?: string
  url?: string | null
  isThumbnail?: boolean
}

export type DesignThumbnailSource = {
  media_files?: DesignMediaFile[] | null
  moodboard?: Record<string, any> | null
  metadata?: Record<string, any> | null
}

const isUsableUrl = (
  value: unknown,
  allowDataUrl: boolean
): value is string => {
  if (typeof value !== "string") {
    return false
  }
  const url = value.trim()
  if (!url) {
    return false
  }
  if (url.startsWith("data:")) {
    return allowDataUrl
  }
  return true
}

/**
 * The first reference image of an Excalidraw moodboard scene: the earliest
 * image element (scene order) whose `fileId` resolves to a usable file URL.
 * Elements deleted on the canvas keep an `isDeleted` marker — skip those.
 */
export const resolveMoodboardFirstImage = (
  moodboard: Record<string, any> | null | undefined,
  { allowDataUrl = false }: { allowDataUrl?: boolean } = {}
): string | null => {
  const elements = moodboard?.elements
  const files = moodboard?.files
  if (!Array.isArray(elements) || !files || typeof files !== "object") {
    return null
  }

  for (const element of elements) {
    if (!element || element.type !== "image" || element.isDeleted) {
      continue
    }
    const file = (files as Record<string, any>)[element.fileId]
    if (isUsableUrl(file?.dataURL, allowDataUrl)) {
      return String(file.dataURL).trim()
    }
  }

  return null
}

/**
 * The single image that represents a design, or null when it has none.
 * Pure — callers supply an already-loaded design row.
 */
export const resolveDesignThumbnail = (
  design: DesignThumbnailSource | null | undefined,
  { allowDataUrl = false }: { allowDataUrl?: boolean } = {}
): string | null => {
  if (!design) {
    return null
  }

  const mediaFiles = Array.isArray(design.media_files) ? design.media_files : []

  const flagged = mediaFiles.find(
    (m) => m?.isThumbnail && isUsableUrl(m?.url, allowDataUrl)
  )
  if (flagged) {
    return String(flagged.url).trim()
  }

  const fromMetadata = design.metadata?.thumbnail
  if (isUsableUrl(fromMetadata, allowDataUrl)) {
    return String(fromMetadata).trim()
  }

  const firstMedia = mediaFiles.find((m) => isUsableUrl(m?.url, allowDataUrl))
  if (firstMedia) {
    return String(firstMedia.url).trim()
  }

  return resolveMoodboardFirstImage(design.moodboard, { allowDataUrl })
}

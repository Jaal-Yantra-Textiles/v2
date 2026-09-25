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
  /**
   * The design's own canonical image. WRITTEN by `design-assistant/pick` when
   * somebody chooses a picture, and by the moodboard save — and, until this
   * was added, read by nothing, so a design that had been given a thumbnail
   * still resolved as though it had none.
   */
  thumbnail_url?: string | null
  moodboard?: Record<string, any> | null
  metadata?: Record<string, any> | null
}

/**
 * Formats an `<img>` cannot decode in Chrome or Firefox. A phone-camera upload
 * lands as HEIC, and pointing an `<img>` at one renders a broken image rather
 * than a picture — indistinguishable, to the person looking at the table, from
 * the thumbnail being missing. Skipping them here lets the derivation fall
 * through to a media file that WILL render, and otherwise show the honest
 * placeholder.
 *
 * (Safari does decode HEIC. Preferring a renderable image everywhere beats a
 * picture that appears for some of the team and not the rest.)
 */
const UNRENDERABLE_EXTENSIONS = [".heic", ".heif", ".tif", ".tiff"]

const isRenderableImageUrl = (url: string): boolean => {
  const path = url.split(/[?#]/)[0].toLowerCase()
  return !UNRENDERABLE_EXTENSIONS.some((ext) => path.endsWith(ext))
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
  return isRenderableImageUrl(url)
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

  /**
   * 🔴 BELOW the flag, deliberately, and this ordering was measured.
   *
   * In a 15-design sample of live data, 4 designs carry BOTH a `thumbnail_url`
   * and a media file flagged `isThumbnail`. Putting `thumbnail_url` first would
   * silently change which picture those 4 show — including in the partner order
   * list, which already calls this — for no gain. Slotted here it changes
   * nothing for them, and gives a picture to the 3 that have a `thumbnail_url`
   * and nothing flagged.
   *
   * An operator flagging a specific file is the more explicit act; this is the
   * design's default.
   */
  const explicit = design.thumbnail_url
  if (isUsableUrl(explicit, allowDataUrl)) {
    return String(explicit).trim()
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

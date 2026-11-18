/**
 * Store reference images and pin them to a design.
 *
 * One path for both doors references come in by — photos the maker uploads
 * (`POST /store/custom/design-assistant/references`) and links they paste into
 * the chat (`add_reference_link`) — so a reference looks the same on the board,
 * in the design's gallery and in admin whichever way it arrived.
 *
 *   1. store the bytes in OUR file storage (public), base64-encoded (#1759)
 *   2. analyse each image (vision, best-effort — cached on the MediaFile)
 *   3. append inspiration elements to the board scene (`design.moodboard`)
 *   4. append to `design.media_files` (the gallery admin reads), deduped by url
 *   5. append the source link to `design.inspiration_sources` (admin shows it)
 *
 * Appends, never replaces: `media_files` and `inspiration_sources` have other
 * writers, and a replace drops their entries.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { uploadFilesWorkflow } from "@medusajs/medusa/core-flows"
import { DESIGN_MODULE } from "../../modules/designs"
import {
  appendInspirationElements,
  normalizeCanvasScene,
} from "../../modules/designs/lib/canvas-scene"
import { analyzeReferenceImages } from "../../mastra/agents/tools/storefront-design-analysis"

export type StoredReference = {
  url: string
  name: string
  media_id: string | null
  analysis: {
    title: string
    description: string
    suggestions: string[]
    analyzed_at: string | null
  } | null
}

/** See the references route: "binary" corrupts every byte >= 0x80 (#1759). */
export const encodeUploadContent = (buffer: Buffer): string => buffer.toString("base64")

export const storeReferenceFiles = async (
  container: MedusaContainer,
  files: Array<{ filename: string; mimeType: string; buffer: Buffer }>
): Promise<Array<{ url: string; name: string }>> => {
  const uploaded: Array<{ url: string; name: string }> = []
  for (const file of files) {
    const out = await uploadFilesWorkflow(container as any).run({
      input: {
        files: [
          {
            filename: file.filename,
            mimeType: file.mimeType,
            content: encodeUploadContent(file.buffer),
            access: "public" as const,
          },
        ],
      },
    })
    const result: any = out.result
    const arr = Array.isArray(result) ? result : (result?.files ?? [])
    const url = arr?.[0]?.url ?? arr?.[0]?.location
    if (url) uploaded.push({ url, name: file.filename })
  }
  return uploaded
}

export const analyzeStoredReferences = async (
  container: MedusaContainer,
  uploaded: Array<{ url: string; name: string }>
): Promise<StoredReference[]> => {
  // Best-effort by construction: a picture that cannot be read is still the
  // maker's picture and still belongs on their board.
  const analyses = await analyzeReferenceImages(
    container,
    uploaded.map((u) => u.url)
  ).catch(() => new Map())

  return uploaded.map((u) => {
    const a: any = analyses.get(u.url) ?? null
    return {
      url: u.url,
      name: u.name,
      media_id: a?.media_id ?? null,
      analysis: a
        ? {
            title: a.title ?? "",
            description: a.description ?? "",
            suggestions: a.suggestions ?? [],
            analyzed_at: a.analyzed_at ?? null,
          }
        : null,
    }
  })
}

/**
 * Append references to the design's board, gallery and (for links) its
 * inspiration sources. Returns false when the write failed — the photos are
 * already stored and analysed, so callers report rather than throw.
 */
export const pinReferencesToDesign = async (
  container: MedusaContainer,
  designId: string,
  references: StoredReference[],
  sourceUrl?: string | null
): Promise<boolean> => {
  const designService: any = container.resolve(DESIGN_MODULE)
  const design = await designService.retrieveDesign(designId).catch(() => null)
  if (!design) return false

  const scene = appendInspirationElements(normalizeCanvasScene(design.moodboard), references)

  const existingMedia: any[] = Array.isArray(design.media_files) ? design.media_files : []
  const seenUrls = new Set(existingMedia.map((m) => m?.url).filter(Boolean))
  const media_files = [
    ...existingMedia,
    ...references
      .filter((r) => !seenUrls.has(r.url))
      .map((r) => ({
        ...(r.media_id ? { id: r.media_id } : {}),
        url: r.url,
        isThumbnail: false,
      })),
  ]

  const update: Record<string, unknown> = { id: designId, moodboard: scene, media_files }
  if (sourceUrl) {
    const sources: string[] = Array.isArray(design.inspiration_sources)
      ? design.inspiration_sources.filter((s: unknown) => typeof s === "string")
      : []
    if (!sources.includes(sourceUrl)) update.inspiration_sources = [...sources, sourceUrl]
  }

  return designService
    .updateDesigns(update)
    .then(() => true)
    .catch(() => false)
}

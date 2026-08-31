/**
 * Design reference analysis — the chat editor's on-the-fly image reader.
 *
 * When the maker sends reference images (inspirations / garment photos), the
 * design tools pin them to the board. This module analyses those images the
 * moment they arrive and records the vision result so it's reusable:
 *
 *   1. `MediaFile.metadata.vision_analysis` — the durable store. Any LLM that
 *      can query the media library reads a grounded, pre-computed description
 *      of the image (title / description / design suggestions) without paying
 *      for another vision call.
 *   2. The scene element's `customData.analysis` — the shop's board renderer
 *      and `get_design_state` surface it back into the chat on later turns.
 *
 * Analysis is BEST-EFFORT: a missing vision provider or a bad image must never
 * stop the maker from pinning their references — we record `null` and move on.
 */
import type { MedusaContainer } from "@medusajs/framework"
import { MEDIA_MODULE } from "../../../modules/media"
import type MediaFileService from "../../../modules/media/service"
import { runAnalyzeProductImage, type ImageAnalysis } from "./storefront-design-catalog"
import { persistTextileAnalysis } from "../../../modules/textile-analysis/lib/persist"

export type ReferenceAnalysis = ImageAnalysis & {
  media_id: string | null
  analyzed_at: string | null
  /** True when the result came from a prior analysis (no fresh vision call). */
  cached?: boolean
}

const resolveMediaService = (container: MedusaContainer): MediaFileService =>
  container.resolve(MEDIA_MODULE) as unknown as MediaFileService

const extensionFromUrl = (url: string): string => {
  const clean = url.split("?")[0].split("#")[0]
  const ext = clean.split(".").pop()?.toLowerCase() || ""
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : "jpg"
}

const mimeFromExtension = (ext: string): string =>
  ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" }[ext]) ?? "image/jpeg"

/** Analyse one image and persist the result onto its MediaFile record. */
const analyzeOne = async (
  container: MedusaContainer,
  url: string
): Promise<ReferenceAnalysis> => {
  const mediaService = resolveMediaService(container)

  // Cache hit — the media was analysed before (upload time, or a prior pin).
  // Return it verbatim instead of paying for another vision call.
  try {
    const existing = await mediaService
      .listMediaFiles({ file_path: url } as any, { take: 1 })
      .catch(() => [])
    const cached: any = (existing?.[0]?.metadata as any)?.vision_analysis
    if (cached?.title) {
      return {
        title: cached.title,
        description: cached.description ?? "",
        suggestions: Array.isArray(cached.suggestions) ? cached.suggestions : [],
        media_id: existing[0].id ?? null,
        analyzed_at: cached.analyzed_at ?? null,
        cached: true,
      }
    }
  } catch {
    /* fall through to a fresh analysis */
  }

  let analysis: ImageAnalysis | null = null

  try {
    analysis = await runAnalyzeProductImage(container, url)
  } catch (err: any) {
    // Best-effort — the image still pins without an analysis.
    console.warn(`[design-reference] vision analysis failed for ${url}: ${err?.message || err}`)
  }

  const analyzedAt = analysis ? new Date().toISOString() : null
  const ext = extensionFromUrl(url)
  const mimeType = mimeFromExtension(ext)

  // Find-or-create the MediaFile record keyed on its public URL, then stamp
  // the analysis into metadata + the human-readable content columns.
  try {
    const existing = await mediaService
      .listMediaFiles({ file_path: url } as any, { take: 1 })
      .catch(() => [])
    const match: any = existing?.[0]

    const payload = {
      ...(analysis
        ? {
            title: analysis.title,
            description: analysis.description,
            alt_text: analysis.description,
          }
        : {}),
      metadata: {
        ...(match?.metadata ?? {}),
        source: (match?.metadata as any)?.source ?? "design-reference",
        vision_analysis: analysis
          ? { ...analysis, analyzed_at: analyzedAt }
          : null,
      },
    }

    let media: any
    if (match) {
      media = await mediaService.updateMediaFiles({ id: match.id, ...payload })
    } else {
      media = await mediaService.createMediaFiles({
        file_name: `reference-${Date.now()}.${ext}`,
        original_name: url.split("/").pop()?.split("?")[0] || url,
        file_path: url,
        file_size: 0,
        file_type: "image",
        mime_type: mimeType,
        extension: ext,
        is_public: true,
        ...payload,
      })
    }

    /**
     * The same analysis, as a TYPED row — one vocabulary for both pipelines.
     *
     * 🔴 Before this, the internal extractor wrote
     * `metadata.textile_extraction` and this path wrote
     * `metadata.vision_analysis`: two schemas for the same question, neither
     * reading the other, and neither filterable. A fabric photograph analysed
     * by one was invisible to the other.
     *
     * `source: "storefront_reference"` is what keeps them distinguishable now
     * that they share a shape — a stranger's inspiration photo and our own
     * extraction over stock we hold deserve different trust, and previously
     * the only thing separating them was which key someone happened to write.
     *
     * Best-effort: the analysis is already returned to the caller and stamped
     * on the scene element. A failure to ALSO type it must not fail the upload.
     */
    if (analysis && media?.id) {
      await persistTextileAnalysis(container, {
        media_id: media.id,
        payload: analysis as unknown as Record<string, any>,
        source: "storefront_reference",
        analyzed_at: analyzedAt,
      }).catch((e: any) => {
        console.warn(
          `[design-reference] textile_analysis write failed for ${url}: ${e?.message || e}`
        )
      })
    }

    return {
      title: analysis?.title ?? "",
      description: analysis?.description ?? "",
      suggestions: analysis?.suggestions ?? [],
      media_id: media?.id ?? null,
      analyzed_at: analyzedAt,
    }
  } catch (err: any) {
    // Media record write failed — still return the analysis (it lives on the
    // scene element), just without a media link.
    console.warn(`[design-reference] media persist failed for ${url}: ${err?.message || err}`)
    return {
      title: analysis?.title ?? "",
      description: analysis?.description ?? "",
      suggestions: analysis?.suggestions ?? [],
      media_id: null,
      analyzed_at: analyzedAt,
    }
  }
}

/**
 * Analyse a batch of reference URLs in parallel and return a url → analysis
 * map (an empty entry means the image was not analysable, not that it failed
 * to pin).
 */
export const analyzeReferenceImages = async (
  container: MedusaContainer,
  urls: string[]
): Promise<Map<string, ReferenceAnalysis>> => {
  const unique = [...new Set(urls.filter((u) => typeof u === "string" && u.startsWith("http")))]
  const results = await Promise.all(unique.map((url) => analyzeOne(container, url)))
  const map = new Map<string, ReferenceAnalysis>()
  unique.forEach((url, i) => map.set(url, results[i]))
  return map
}

/** Single-image analysis — the entry point the upload endpoint calls. */
export const analyzeReferenceImage = analyzeOne
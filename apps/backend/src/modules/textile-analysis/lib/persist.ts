import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { MEDIA_MODULE } from "../../media"
import { TEXTILE_ANALYSIS_MODULE } from "../index"
import {
  normaliseTextileAnalysis,
  type TextileAnalysisSource,
} from "./normalise"

/**
 * Write a vision result as a typed `textile_analysis` row linked to its media
 * file — and mirror the human-readable parts onto the media file's own columns.
 *
 * ## What this replaces
 *
 * `MediaFile.metadata.textile_extraction`. Measured on production before the
 * cutover: of the 37 media files carrying that blob, **37 had a `title` and a
 * `description` inside it and 0 had the TYPED `MediaFile.title` /
 * `description` / `alt_text` columns set** — columns that already existed, with
 * `title` one of the two `.searchable()` fields. A good title was computed 37
 * times and the media library, SEO and screen-reader alt text all read the
 * empty column instead.
 *
 * The blob also could not be filtered: `query.graph` does not reach into JSON
 * subkeys, so "show me more fabrics like this" — the feature this data exists
 * to serve — was not buildable on it.
 *
 * 🔑 The mirror is the point of the second write. The typed row is where the
 * FILTERING happens; `MediaFile.title/description/alt_text` is where the
 * RENDERING happens. Both, or the work stays invisible somewhere.
 *
 * ⚠️ `metadata` is left ALONE. It is a shared bag with at least five writers —
 * partner upload, WhatsApp `wa_media_id`, raw-material binding, captions — and
 * the old code replaced the whole object. Not touching it is the fix.
 */
export const persistTextileAnalysis = async (
  container: MedusaContainer,
  input: {
    media_id: string
    payload: Record<string, any> | null | undefined
    source: TextileAnalysisSource
    model_name?: string | null
    analyzed_at?: Date | string | null
  }
): Promise<{ analysis_id: string | null }> => {
  const service: any = container.resolve(TEXTILE_ANALYSIS_MODULE)
  const mediaService: any = container.resolve(MEDIA_MODULE)
  const link: any = container.resolve(ContainerRegistrationKeys.LINK)

  const normalised = normaliseTextileAnalysis(input.payload, {
    source: input.source,
    model_name: input.model_name ?? null,
    analyzed_at: input.analyzed_at ?? new Date(),
  })

  const created = await service.createTextileAnalyses(normalised)
  const row = Array.isArray(created) ? created[0] : created
  if (!row?.id) return { analysis_id: null }

  /**
   * ⚠️ `link.create` is NOT idempotent. Re-analysing an image is a legitimate
   * second ROW (a newer model, a different source) and therefore a legitimate
   * second link — but a failed link on a successful row would strand the
   * analysis where nothing can find it, so this is not allowed to be silent.
   */
  await link.create({
    [MEDIA_MODULE]: { media_file_id: input.media_id },
    [TEXTILE_ANALYSIS_MODULE]: { textile_analysis_id: row.id },
  })

  // Mirror onto the media file's own columns — the searchable/renderable ones
  // that sat empty for every one of the 37 rows this replaces.
  const mirror: Record<string, any> = {}
  if (normalised.title) mirror.title = normalised.title
  if (normalised.description) {
    mirror.description = normalised.description
    mirror.alt_text = normalised.description
  }
  if (Object.keys(mirror).length) {
    await mediaService
      .updateMediaFiles({ id: input.media_id, ...mirror })
      .catch(() => {
        // The analysis is stored and linked; a failed mirror costs search
        // quality, not the result.
      })
  }

  return { analysis_id: row.id }
}

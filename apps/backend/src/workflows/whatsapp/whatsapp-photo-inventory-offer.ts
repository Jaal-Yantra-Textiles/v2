/**
 * #2138 — a photo the partner sent because they are SELLING us material.
 *
 * When an admin has said "these will be photos of the lot they're offering us",
 * the useful fact about the image is what the cloth IS: its type, weave, weight
 * and colour. That is exactly a `textile_analysis`, and the `partner_upload`
 * source value has existed on the model all along — it was simply never
 * written, because nothing ever knew a photo was an inventory offer.
 *
 * 🔴 `source: "partner_upload"` is the whole point of the row. The same image
 * analysed by the internal extractor is `internal_extraction` and means "we
 * looked at our own picture"; this one means "a supplier showed us this and we
 * read it". Collapsing the two would make provenance unrecoverable — the
 * question "what has this partner offered us?" is answerable only by source.
 *
 * ⚠️ This does NOT create an inventory order. Minting a purchase from a
 * photograph is the same presumption #2138 removed from product creation, in a
 * more expensive place. The row is a reading of the image, nothing more; a
 * human still decides whether we buy it.
 */

import { runTextileMastraExtraction } from "../ai/textile-product-extraction"
import { persistTextileAnalysis } from "../../modules/textile-analysis/lib/persist"

export type InventoryOfferFiling = {
  analysis_id: string | null
  /** Why nothing was written, when nothing was. Never thrown at the partner. */
  skipped_reason?: string
}

/**
 * Read the image and file it as a partner's offer.
 *
 * Never throws. The photo is already saved and the partner is already being
 * answered; an extractor that is slow, unconfigured or wrong must not turn a
 * successful upload into an error the partner sees. It returns the reason
 * instead, for the log.
 */
export async function fileInventoryOfferAnalysis(
  scope: any,
  input: {
    mediaFileId: string | null
    imageUrl: string
    /** The admin's own words about what this is about, used as a hint. */
    note?: string | null
    timeoutMs?: number
  }
): Promise<InventoryOfferFiling> {
  if (!input.mediaFileId) {
    // The link is media↔analysis. Without the row's id there is nothing to
    // hang the analysis on, and an unlinked analysis is unfindable.
    return { analysis_id: null, skipped_reason: "no_media_file_id" }
  }
  if (!input.imageUrl) {
    return { analysis_id: null, skipped_reason: "no_image_url" }
  }

  const timeoutMs = input.timeoutMs ?? 45_000

  try {
    const extraction = await Promise.race([
      runTextileMastraExtraction(
        {
          image_url: input.imageUrl,
          // The admin's note is a HINT, never an answer. "the leftover pashmina
          // we discussed" helps the model read the picture; it does not decide
          // what the picture contains.
          hints: input.note ? [input.note] : undefined,
        },
        scope
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ])

    if (!extraction) {
      return { analysis_id: null, skipped_reason: "extraction_timeout" }
    }

    const { analysis_id } = await persistTextileAnalysis(scope, {
      media_id: input.mediaFileId,
      payload: extraction as unknown as Record<string, any>,
      source: "partner_upload",
    })

    return { analysis_id }
  } catch (e: any) {
    console.warn(
      `[whatsapp-photo] inventory-offer analysis failed: ${e?.message ?? e}`
    )
    return { analysis_id: null, skipped_reason: "extraction_failed" }
  }
}

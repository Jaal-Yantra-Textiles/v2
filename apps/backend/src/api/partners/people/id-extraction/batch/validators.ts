import { z } from "@medusajs/framework/zod"

import { MAX_ID_BATCH_IMAGES } from "../../../../../workflows/ai/id-extraction-batch"

const imageUrl = z.string().refine(
  (s) => {
    if (!s) return false
    if (s.startsWith("data:")) return true
    try {
      new URL(s)
      return true
    } catch {
      return false
    }
  },
  { message: "each image must be a valid URL or data URI" }
)

/**
 * Partner-side BATCH ID extraction (#1816).
 *
 * ⚠️ Deliberately has NO `partner_id`, exactly like the single-photo
 * validator. The partner comes from the authenticated actor; a body that could
 * name another partner is the cross-tenant write this platform has been bitten
 * by before.
 */
export const PartnerIdExtractionBatchReq = z.object({
  image_urls: z.array(imageUrl).min(1).max(MAX_ID_BATCH_IMAGES),
  notes: z.string().optional(),
  id_number_policy: z.enum(["mask", "discard"]).optional(),
  person_type_ids: z.array(z.string()).optional(),
  /**
   * Milliseconds between photographs. Clamped server-side — a caller cannot
   * talk the platform into hammering the provider by asking nicely.
   */
  interval_ms: z.number().int().positive().optional(),
  /**
   * Start reading immediately instead of waiting for a separate confirm call.
   * The two-step shape exists so someone can check they photographed the right
   * ten people; a client that already knows can skip it.
   */
  auto_confirm: z.boolean().optional(),
})

export type PartnerIdExtractionBatchReqType = z.infer<
  typeof PartnerIdExtractionBatchReq
>

/**
 * Approving drafts into people. `item_ids` omitted means "every item with a
 * usable draft".
 */
export const PartnerIdExtractionBatchApproveReq = z.object({
  item_ids: z.array(z.string()).optional(),
  corrections: z.record(z.string(), z.record(z.string(), z.any())).optional(),
})

export type PartnerIdExtractionBatchApproveReqType = z.infer<
  typeof PartnerIdExtractionBatchApproveReq
>

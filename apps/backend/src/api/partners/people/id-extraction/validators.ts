import { z } from "@medusajs/framework/zod"

/**
 * Partner-side ID extraction.
 *
 * ⚠️ Deliberately has NO `partner_id`. The partner is taken from the
 * authenticated actor, never from the body — a partner naming another
 * partner's id is exactly the cross-tenant write this platform has been bitten
 * by before (validate both ends of any request that names an id).
 */
export const PartnerIdExtractionReq = z.object({
  image_url: z
    .string()
    .refine(
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
      { message: "image_url must be a valid URL or data URI" }
    ),
  notes: z.string().optional(),
  id_number_policy: z.enum(["mask", "discard"]).optional(),
  persist: z.boolean().optional(),
  confirm: z.boolean().optional(),
  person_type_ids: z.array(z.string()).optional(),
})

export type PartnerIdExtractionReqType = z.infer<typeof PartnerIdExtractionReq>

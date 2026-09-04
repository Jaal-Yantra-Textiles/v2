import { z } from "@medusajs/framework/zod"

/**
 * ⚠️ `zodValidator` forces `.strict()`, so every field a caller may send must
 * appear here — a field missing from this schema is a 400, not a silent drop.
 * It must also stay in step with the MCP registry rows' `bodyParams`, which is
 * where the tool's own contract lives (an MCP row is a contract with its
 * validator).
 */
export const AdminIdExtractionReq = z.object({
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
  /**
   * 🔴 No `"store"` option, deliberately. Retaining a full Aadhaar/PAN number
   * is a decision that needs a retention policy and an encrypted column, not a
   * flag on an extraction tool. See `lib/people/id-card.ts`.
   */
  id_number_policy: z.enum(["mask", "discard"]).optional(),
  /** Preview unless explicitly asked otherwise. */
  persist: z.boolean().optional(),
  /** Required alongside `persist` — creating a person from a photo is not undoable by the caller. */
  confirm: z.boolean().optional(),
  partner_id: z.string().optional(),
  person_type_ids: z.array(z.string()).optional(),
})

export type AdminIdExtractionReqType = z.infer<typeof AdminIdExtractionReq>

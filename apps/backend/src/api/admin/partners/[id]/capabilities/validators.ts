import { z } from "@medusajs/framework/zod"

/**
 * The admin half of the capability library (#1531): photographs of what a
 * partner has actually made, filed by an operator.
 *
 * Mirrors the partner-portal schemas (`PartnerListCapabilitySamplesQuery` /
 * `PartnerPostCapabilitySampleReq` in src/api/partners/inquiries/validators.ts)
 * field-for-field. `partner_id` appears in NONE of these schemas deliberately —
 * it is taken from the URL, never the body, so the sample lands on the partner
 * the path names and nowhere else.
 */

export const AdminListPartnerCapabilitiesQuery = z.object({
  technique: z.string().optional(),
  material: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
})
export type AdminListPartnerCapabilitiesQuery = z.infer<
  typeof AdminListPartnerCapabilitiesQuery
>

/**
 * `captured_at` is optional but NOT defaulted to now in the schema: the route
 * defaults it and SAYS SO in the response. A photo typed up three weeks after
 * it was taken describes a capability that may already be gone, and the
 * library is only trustworthy if it says how stale each row is.
 */
export const AdminCreatePartnerCapabilityReq = z.object({
  title: z.string().min(1),
  technique: z.string().optional().nullable(),
  material: z.string().optional().nullable(),
  media_file_ids: z.array(z.string().min(1)).optional(),
  notes: z.string().optional().nullable(),
  captured_at: z.coerce.date().optional().nullable(),
})
export type AdminCreatePartnerCapabilityReq = z.infer<
  typeof AdminCreatePartnerCapabilityReq
>

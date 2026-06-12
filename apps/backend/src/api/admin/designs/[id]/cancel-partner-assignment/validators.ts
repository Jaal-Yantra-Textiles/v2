import { z } from "zod"

export const CancelPartnerAssignmentSchema = z.object({
  partner_id: z.string().min(1, "partner_id is required"),
  unlink: z.boolean().optional().default(false),
})

export type CancelPartnerAssignmentReq = z.infer<
  typeof CancelPartnerAssignmentSchema
>

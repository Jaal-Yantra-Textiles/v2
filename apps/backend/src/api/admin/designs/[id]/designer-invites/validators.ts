import { z } from "zod"

export const AdminCreateDesignerInviteSchema = z.object({
  // Optional recipient lock. When present, accept must present this email.
  email: z.string().email().optional(),
  // Days until the link expires. Omit for a non-expiring link.
  expires_in_days: z.number().int().positive().max(365).optional(),
  // Grant role stamped onto the design↔partner link (defaults to "designer").
  role: z.string().optional(),
  // Display name for the landing page ("Invited by <brand>").
  inviter_name: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export type AdminCreateDesignerInviteReq = z.infer<typeof AdminCreateDesignerInviteSchema>

import { z } from "zod"

export const AcceptDesignerInviteSchema = z.object({
  // The designer's display name (used as both partner + admin name for a solo
  // designer; can be split later).
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
})

export type AcceptDesignerInviteReq = z.infer<typeof AcceptDesignerInviteSchema>

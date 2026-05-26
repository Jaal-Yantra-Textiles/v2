import { z } from "@medusajs/framework/zod"

export const personContactRequestSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().max(40).optional().nullable(),
  message: z.string().max(2000).optional().nullable(),
  source: z.string().max(80).optional().nullable(),
})

export type PersonContactRequest = z.infer<typeof personContactRequestSchema>

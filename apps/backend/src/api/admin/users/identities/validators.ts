import { z } from "@medusajs/framework/zod"

export const ListIdentitiesQuerySchema = z.object({
  email: z.email(),
})

export type ListIdentitiesQuery = z.infer<typeof ListIdentitiesQuerySchema>

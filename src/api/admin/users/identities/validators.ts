import { z } from "zod"

export const ListIdentitiesQuerySchema = z.object({
  email: z.string().email(),
})

export type ListIdentitiesQuery = z.infer<typeof ListIdentitiesQuerySchema>

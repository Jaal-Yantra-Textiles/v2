import { z } from "zod"

export const listDesignsQuerySchema = z.object({
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
  status: z.string().optional(),
})

export type ListDesignsQuery = z.infer<typeof listDesignsQuerySchema>

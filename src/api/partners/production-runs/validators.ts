import { z } from "@medusajs/framework/zod"

export const listProductionRunsQuerySchema = z.object({
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
  status: z.string().optional(),
  role: z.string().optional(),
})

export type ListProductionRunsQuery = z.infer<typeof listProductionRunsQuerySchema>

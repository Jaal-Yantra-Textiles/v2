import { z } from "@medusajs/framework/zod"

export const listEmailEditorProductsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
})

export type ListEmailEditorProductsQuery = z.infer<typeof listEmailEditorProductsQuerySchema>

import { z } from "zod"

export const ListInventoryItemRawMaterialsQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.preprocess(
    (val) => (val != null && typeof val === "string" ? parseInt(val) : val),
    z.number().min(1).max(100).optional().default(10)
  ),
  offset: z.preprocess(
    (val) => (val != null && typeof val === "string" ? parseInt(val) : val),
    z.number().min(0).optional().default(0)
  ),
  filters: z.preprocess(
    (val) => {
      if (typeof val === "string") {
        try {
          return JSON.parse(val)
        } catch {
          return val
        }
      }
      return val
    },
    z.record(z.unknown()).optional()
  ),
})

export type ListInventoryItemRawMaterialsQuery = z.infer<typeof ListInventoryItemRawMaterialsQuerySchema>

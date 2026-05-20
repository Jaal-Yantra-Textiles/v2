import { z } from "@medusajs/framework/zod"
import { createFindParams } from "@medusajs/medusa/api/utils/validators"

export const ListInventoryItemRawMaterialsQuerySchema = createFindParams({
  limit: 10,
  offset: 0,
}).extend({
  q: z.string().optional(),
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
    z.record(z.string(), z.unknown()).optional()
  ),
})

export type ListInventoryItemRawMaterialsQuery = z.infer<typeof ListInventoryItemRawMaterialsQuerySchema>

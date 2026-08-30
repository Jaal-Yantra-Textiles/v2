import { z } from "@medusajs/framework/zod"
import { createFindParams } from "@medusajs/medusa/api/utils/validators"

export const INVENTORY_CATALOG_KINDS = [
  "raw_material",
  "product",
  "both",
  "unclassified",
] as const

export const ListInventoryCatalogQuerySchema = createFindParams({
  limit: 20,
  offset: 0,
}).extend({
  q: z.string().optional(),
  /**
   * Optional narrowing for callers that genuinely want one kind. Omitted means
   * the whole catalog — the default must never be a partition (#1662/#1621).
   */
  kinds: z
    .preprocess(
      (val) => (typeof val === "string" ? val.split(",") : val),
      z.array(z.enum(INVENTORY_CATALOG_KINDS))
    )
    .optional(),
})

export type ListInventoryCatalogQuery = z.infer<
  typeof ListInventoryCatalogQuerySchema
>

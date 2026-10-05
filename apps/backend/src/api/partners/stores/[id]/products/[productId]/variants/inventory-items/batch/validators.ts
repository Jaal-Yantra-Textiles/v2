import { z } from "@medusajs/framework/zod"

// `required_quantity` is how many of the stock item ONE unit of the variant
// uses. Core accepts any number; 0 or a negative would make a free or
// stock-creating kit, so it must be positive here.
const kitRow = z
  .object({
    variant_id: z.string().min(1),
    inventory_item_id: z.string().min(1),
    required_quantity: z.number().positive(),
  })
  .strict()

export const PartnerBatchVariantInventoryItemsSchema = z
  .object({
    create: z.array(kitRow).optional(),
    update: z.array(kitRow).optional(),
    delete: z
      .array(
        z.object({ variant_id: z.string().min(1), inventory_item_id: z.string().min(1) }).strict()
      )
      .optional(),
  })
  .strict()

export type PartnerBatchVariantInventoryItems = z.infer<
  typeof PartnerBatchVariantInventoryItemsSchema
>

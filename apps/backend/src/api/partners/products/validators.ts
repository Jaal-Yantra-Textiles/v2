import { z } from "@medusajs/framework/zod"

// Minimal validator to accept a product payload and target store
// We rely on createProductsWorkflow to validate deeper product structure
export const PartnerCreateProductReq = z
  .object({
    store_id: z.string().min(1, "store_id is required"),
    product: z.record(z.string(), z.any()),
  })
  .strict()

export type PartnerCreateProductReqType = z.infer<typeof PartnerCreateProductReq>

// #859 S3 (#862): the partner-editable "made-to-order & maker story" fields for
// an artisan product. All optional — a partner may set only a maker story, or
// only flip made-to-order, etc. `null` explicitly clears a field.
export const PartnerArtisanProductDetailReq = z
  .object({
    made_to_order: z.boolean().optional(),
    lead_time_days: z.number().int().min(0).max(3650).nullable().optional(),
    lead_time_label: z.string().trim().max(120).nullable().optional(),
    min_order_quantity: z.number().int().min(1).max(100000).nullable().optional(),
    maker_story: z.string().trim().max(5000).nullable().optional(),
  })
  .strict()

export type PartnerArtisanProductDetailReqType = z.infer<
  typeof PartnerArtisanProductDetailReq
>

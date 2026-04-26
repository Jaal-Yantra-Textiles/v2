import { z } from "@medusajs/framework/zod"

// Minimal validator to accept a product payload and target store
// We rely on createProductsWorkflow to validate deeper product structure
export const PartnerCreateProductReq = z
  .object({
    store_id: z.string().min(1, "store_id is required"),
    product: z.record(z.any()),
  })
  .strict()

export type PartnerCreateProductReqType = z.infer<typeof PartnerCreateProductReq>

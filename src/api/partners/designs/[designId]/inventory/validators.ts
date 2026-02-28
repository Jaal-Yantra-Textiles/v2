import { z } from "@medusajs/framework/zod"

export const PartnerDesignInventorySchema = z.object({
  inventory_used: z.preprocess((val) => {
    if (typeof val === "string") {
      const num = Number(val)
      return Number.isNaN(num) ? val : num
    }
    return val
  }, z.number().finite()),
})

export type PartnerDesignInventoryReq = z.infer<typeof PartnerDesignInventorySchema>

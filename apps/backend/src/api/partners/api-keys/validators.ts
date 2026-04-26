import { z } from "@medusajs/framework/zod"

export const PartnerCreateApiKeyReq = z.object({
  title: z.string().min(1),
})

export const PartnerUpdateApiKeyReq = z.object({
  title: z.string().min(1),
})

export const PartnerBatchSalesChannelsReq = z.object({
  add: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
})

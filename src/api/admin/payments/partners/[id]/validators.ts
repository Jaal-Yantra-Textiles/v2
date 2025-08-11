import { z } from "zod"

export const ListPaymentsByPartnerQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
})

export type ListPaymentsByPartnerQuery = z.infer<typeof ListPaymentsByPartnerQuerySchema>

export const ListPaymentsByPartnerQuery = ListPaymentsByPartnerQuerySchema

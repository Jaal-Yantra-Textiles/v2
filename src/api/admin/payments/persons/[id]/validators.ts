import { z } from "zod"

export const ListPaymentsByPersonQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
})

export type ListPaymentsByPersonQuery = z.infer<typeof ListPaymentsByPersonQuerySchema>

export const ListPaymentsByPersonQuery = ListPaymentsByPersonQuerySchema

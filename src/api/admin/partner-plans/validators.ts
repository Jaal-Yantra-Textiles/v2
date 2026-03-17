import { z } from "@medusajs/framework/zod"

export const createPlanSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  price: z.number().min(0),
  currency_code: z.string().default("inr"),
  interval: z.enum(["monthly", "yearly"]).default("monthly"),
  features: z.record(z.unknown()).optional(),
  is_active: z.boolean().default(true),
  sort_order: z.number().default(0),
  metadata: z.record(z.unknown()).optional(),
})

export const updatePlanSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  price: z.number().min(0).optional(),
  currency_code: z.string().optional(),
  interval: z.enum(["monthly", "yearly"]).optional(),
  features: z.record(z.unknown()).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export const createSubscriptionSchema = z.object({
  partner_id: z.string().min(1),
  plan_id: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
})

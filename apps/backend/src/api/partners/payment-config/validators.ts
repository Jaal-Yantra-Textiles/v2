import { z } from "zod"

export const CreatePaymentConfigSchema = z.object({
  provider_id: z.enum(["pp_payu_payu", "pp_stripe_stripe"]),
  credentials: z.object({
    // PayU
    merchant_key: z.string().optional(),
    merchant_salt: z.string().optional(),
    mode: z.enum(["test", "live"]).optional(),
    // Stripe
    api_key: z.string().optional(),
  }),
  is_active: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
})

export const UpdatePaymentConfigSchema = z.object({
  credentials: z.object({
    merchant_key: z.string().optional(),
    merchant_salt: z.string().optional(),
    mode: z.enum(["test", "live"]).optional(),
    api_key: z.string().optional(),
  }).optional(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
})

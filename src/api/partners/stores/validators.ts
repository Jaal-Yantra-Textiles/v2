import { z } from "zod"

// Input payload to create a store with defaults from Partner API
// Mirrors `CreateStoreWithDefaultsInput` with reasonable validations
export const PartnerCreateStoreReq = z
  .object({
    // Optional: partner_id can be provided but will be overridden by server auth context
    partner_id: z.string().min(1).optional(),
    store: z
      .object({
        name: z.string().min(1, "Store name is required"),
        supported_currencies: z
          .array(
            z.object({
              currency_code: z.string().min(1),
              is_default: z.boolean().optional(),
            })
          )
          .min(1, "At least one supported currency is required"),
        metadata: z.record(z.any()).optional(),
      })
      .strict(),

    sales_channel: z
      .object({
        name: z.string().optional(),
        description: z.string().optional(),
      })
      .partial()
      .optional(),

    region: z
      .object({
        name: z.string().min(1),
        currency_code: z.string().min(1),
        countries: z.array(z.string().min(2)).min(1), // lower-case ISO2, e.g., ["us"]
        payment_providers: z.array(z.string()).optional(),
        metadata: z.record(z.any()).optional(),
      })
      .strict(),

    location: z
      .object({
        name: z.string().min(1),
        address: z
          .object({
            address_1: z.string().min(1),
            address_2: z.string().nullable().optional(),
            city: z.string().nullable().optional(),
            province: z.string().nullable().optional(),
            postal_code: z.string().nullable().optional(),
            country_code: z.string().length(2), // upper-case ISO2 expected by stock locations
          })
          .strict(),
        metadata: z.record(z.any()).optional(),
      })
      .strict(),
  })
  .strict()

export type PartnerCreateStoreReqType = z.infer<typeof PartnerCreateStoreReq>

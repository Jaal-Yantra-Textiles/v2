import { z } from "zod"

/**
 * A warehouse, and only a warehouse (#2061).
 *
 * Deliberately has no `store`, `sales_channel`, `region` or currency block —
 * the whole point of this route is that holding goods does not require a
 * storefront. `currency_code` is accepted only because carrier auto-registration
 * reads it; it denominates nothing.
 */
export const WarehouseAddressSchema = z.object({
  address_1: z.string().min(1, "A street address is required to register a pickup point."),
  address_2: z.string().nullish(),
  city: z.string().nullish(),
  /** ISO-2. Decides which carriers are registered. */
  country_code: z.string().min(2).max(2),
  province: z.string().nullish(),
  postal_code: z.string().nullish(),
  phone: z.string().nullish(),
  company: z.string().nullish(),
})

export const CreatePartnerWarehouseReq = z.object({
  name: z.string().min(1),
  address: WarehouseAddressSchema,
  metadata: z.record(z.string(), z.any()).nullish(),
  currency_code: z.string().min(3).max(3).optional(),
})

export type CreatePartnerWarehouseReqType = z.infer<
  typeof CreatePartnerWarehouseReq
>

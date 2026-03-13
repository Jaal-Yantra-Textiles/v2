import { z } from "@medusajs/framework/zod"

export const PartnerCreateRegionReq = z.object({
  name: z.string().min(1),
  currency_code: z.string().min(1),
  countries: z.array(z.string()).optional(),
  payment_providers: z.array(z.string()).optional(),
  automatic_taxes: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
})

export type PartnerCreateRegionReqType = z.infer<typeof PartnerCreateRegionReq>

export const PartnerUpdateRegionReq = z.object({
  name: z.string().optional(),
  currency_code: z.string().optional(),
  countries: z.array(z.string()).optional(),
  payment_providers: z.array(z.string()).optional(),
  automatic_taxes: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
})

export type PartnerUpdateRegionReqType = z.infer<typeof PartnerUpdateRegionReq>

export const PartnerUpdateLocationReq = z.object({
  name: z.string().optional(),
  address: z
    .object({
      address_1: z.string().optional(),
      address_2: z.string().nullable().optional(),
      city: z.string().nullable().optional(),
      province: z.string().nullable().optional(),
      postal_code: z.string().nullable().optional(),
      country_code: z.string().optional(),
    })
    .optional(),
  metadata: z.record(z.any()).optional(),
})

export type PartnerUpdateLocationReqType = z.infer<typeof PartnerUpdateLocationReq>

export const PartnerCreateFulfillmentSetReq = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  service_zones: z
    .array(
      z.object({
        name: z.string().min(1),
        geo_zones: z.array(
          z.object({
            country_code: z.string().min(1),
            type: z.string().default("country"),
          })
        ),
      })
    )
    .optional(),
})

export type PartnerCreateFulfillmentSetReqType = z.infer<typeof PartnerCreateFulfillmentSetReq>

export const PartnerUpdateFulfillmentProvidersReq = z.object({
  add: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
})

export type PartnerUpdateFulfillmentProvidersReqType = z.infer<typeof PartnerUpdateFulfillmentProvidersReq>

export const PartnerCreateShippingOptionReq = z.object({
  name: z.string().min(1),
  price_type: z.string().min(1),
  provider_id: z.string().min(1),
  service_zone_id: z.string().min(1),
  shipping_profile_id: z.string().min(1),
  type: z.object({
    label: z.string().min(1),
    description: z.string().optional(),
    code: z.string().min(1),
  }),
  prices: z.array(
    z.object({
      currency_code: z.string().optional(),
      region_id: z.string().optional(),
      amount: z.number(),
    })
  ),
  rules: z
    .array(
      z.object({
        attribute: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]),
        operator: z.string(),
      })
    )
    .optional(),
  data: z.record(z.any()).optional(),
})

export type PartnerCreateShippingOptionReqType = z.infer<typeof PartnerCreateShippingOptionReq>

export const PartnerUpdateShippingOptionReq = z.object({
  name: z.string().optional(),
  price_type: z.string().optional(),
  provider_id: z.string().optional(),
  service_zone_id: z.string().optional(),
  shipping_profile_id: z.string().optional(),
  type: z
    .object({
      label: z.string().optional(),
      description: z.string().optional(),
      code: z.string().optional(),
    })
    .optional(),
  prices: z
    .array(
      z.object({
        id: z.string().optional(),
        currency_code: z.string().optional(),
        region_id: z.string().optional(),
        amount: z.number(),
      })
    )
    .optional(),
  rules: z
    .array(
      z.object({
        attribute: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]),
        operator: z.string(),
      })
    )
    .optional(),
  data: z.record(z.any()).optional(),
})

export type PartnerUpdateShippingOptionReqType = z.infer<typeof PartnerUpdateShippingOptionReq>

export const PartnerCreateShippingProfileReq = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
})

export type PartnerCreateShippingProfileReqType = z.infer<typeof PartnerCreateShippingProfileReq>

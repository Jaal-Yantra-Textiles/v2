import { z } from "@medusajs/framework/zod"

// Region body validators
//
// Shape mirrors Medusa core's `AdminCreateRegion` / `AdminUpdateRegion`
// validators (see `@medusajs/medusa/dist/api/admin/regions/validators.js`)
// so partner clients can send the same body as admin clients. The
// `is_tax_inclusive` field MUST be accepted at the partner edge — admin
// includes it and `.strict()` here would otherwise reject it.
//
// See apps/docs/notes/PARTNER_API_PARITY.md for the audit register.
export const PartnerCreateRegionReq = z.object({
  name: z.string().min(1),
  currency_code: z.string().min(1),
  countries: z.array(z.string()).optional(),
  automatic_taxes: z.boolean().optional(),
  is_tax_inclusive: z.boolean().optional(),
  payment_providers: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
}).strict()

export type PartnerCreateRegionReqType = z.infer<typeof PartnerCreateRegionReq>

export const PartnerUpdateRegionReq = z.object({
  name: z.string().optional(),
  currency_code: z.string().optional(),
  countries: z.array(z.string()).optional(),
  automatic_taxes: z.boolean().optional(),
  is_tax_inclusive: z.boolean().optional(),
  payment_providers: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
}).strict()

export type PartnerUpdateRegionReqType = z.infer<typeof PartnerUpdateRegionReq>

// Region list query validator
//
// Mirrors `AdminGetRegionsParams` (`@medusajs/medusa/dist/api/admin/regions/
// validators.js`). Pagination defaults match admin's `listTransformQueryConfig`
// (limit: 20, offset: 0) — the transform config wins over the validator's
// own default of 50.
export const PartnerListRegionsParams = z.object({
  q: z.string().optional(),
  id: z.union([z.string(), z.array(z.string())]).optional(),
  currency_code: z.union([z.string(), z.array(z.string())]).optional(),
  name: z.union([z.string(), z.array(z.string())]).optional(),
  fields: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  order: z.string().optional(),
})

export type PartnerListRegionsParamsType = z.infer<typeof PartnerListRegionsParams>

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
  metadata: z.record(z.string(), z.any()).optional(),
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
  }).optional(),
  type_id: z.string().optional(),
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
  data: z.record(z.string(), z.any()).optional(),
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
  data: z.record(z.string(), z.any()).optional(),
})

export type PartnerUpdateShippingOptionReqType = z.infer<typeof PartnerUpdateShippingOptionReq>

export const PartnerCreateShippingProfileReq = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
})

export type PartnerCreateShippingProfileReqType = z.infer<typeof PartnerCreateShippingProfileReq>

// Store update
export const PartnerUpdateStoreReq = z.object({
  name: z.string().optional(),
  supported_currencies: z
    .array(
      z.object({
        currency_code: z.string(),
        is_default: z.boolean().optional(),
      })
    )
    .optional(),
  default_sales_channel_id: z.string().nullable().optional(),
  default_region_id: z.string().nullable().optional(),
  default_location_id: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export type PartnerUpdateStoreReqType = z.infer<typeof PartnerUpdateStoreReq>

// Sales Channels
export const PartnerCreateSalesChannelReq = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  is_disabled: z.boolean().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export type PartnerCreateSalesChannelReqType = z.infer<typeof PartnerCreateSalesChannelReq>

export const PartnerUpdateSalesChannelReq = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  is_disabled: z.boolean().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export type PartnerUpdateSalesChannelReqType = z.infer<typeof PartnerUpdateSalesChannelReq>

// Tax Regions
//
// Shape mirrors Medusa core's `CreateTaxRegion` admin validator (see
// `@medusajs/medusa/dist/api/admin/tax-regions/validators.js`) so the
// partner endpoint can hand the body straight to `createTaxRegionsWorkflow`.
//
// `provider_id` MUST be accepted at the partner edge — the partner-ui's
// tax-region create form (apps/partner-ui/src/routes/tax-regions/tax-region-create/...)
// always sends it. Without it here, the strict middleware errors out
// with "Unrecognized fields: 'provider_id'" before the route ever runs.
//
// The refinement matches admin behavior: a root tax region (no
// `parent_id`) requires a `provider_id`; a province-level region
// inherits its parent's provider.
export const PartnerCreateTaxRegionReq = z
  .object({
    country_code: z.string().min(1),
    provider_id: z.string().nullable().optional(),
    province_code: z.string().nullable().optional(),
    parent_id: z.string().nullable().optional(),
    default_tax_rate: z
      .object({
        rate: z.number().optional(),
        code: z.string().optional(),
        name: z.string().optional(),
        is_combinable: z.boolean().optional(),
        metadata: z.record(z.string(), z.any()).nullable().optional(),
      })
      .optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .refine((data) => data.parent_id || data.provider_id, {
    path: ["provider_id"],
    message:
      "Provider is required when creating a non-province tax region.",
  })

export type PartnerCreateTaxRegionReqType = z.infer<typeof PartnerCreateTaxRegionReq>

export const PartnerUpdateTaxRegionReq = z.object({
  province_code: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

export type PartnerUpdateTaxRegionReqType = z.infer<typeof PartnerUpdateTaxRegionReq>

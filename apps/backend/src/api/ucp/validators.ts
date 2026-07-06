import { z } from "@medusajs/framework/zod"

// UCP address format — per spec postal_address.json.
const UcpAddressSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  street_address: z.string(),
  extended_address: z.string().optional(),
  address_locality: z.string(),
  address_region: z.string().optional(),
  address_country: z.string().min(2),
  postal_code: z.string(),
  phone_number: z.string().optional(),
})

const UcpBuyerSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().email().optional(),
  phone_number: z.string().optional(),
  full_name: z.string().optional(),
})

export const CreateUcpCheckoutSessionSchema = z.object({
  line_items: z.array(z.object({
    item: z.object({ id: z.string(), title: z.string().optional() }),
    quantity: z.number().int().positive(),
  })).min(1),
  context: z.object({
    address_country: z.string().optional(),
    address_region: z.string().optional(),
    postal_code: z.string().optional(),
    currency: z.string().optional(),
    region_id: z.string().optional(),
    language: z.string().optional(),
  }).optional(),
  buyer: UcpBuyerSchema.optional(),
  shipping_address: UcpAddressSchema.optional(),
  payment: z.object({
    instruments: z.array(z.any()).optional(),
    handlers: z.array(z.any()).optional(),
  }).optional(),
  discounts: z.object({
    codes: z.array(z.string()).optional(),
  }).optional(),
})

const UcpFulfillmentGroupUpdateSchema = z.object({
  id: z.string().optional(),
  selected_option_id: z.string().nullable().optional(),
}).passthrough()

const UcpFulfillmentMethodUpdateSchema = z.object({
  id: z.string().optional(),
  type: z.enum(["shipping", "pickup"]).optional(),
  selected_destination_id: z.string().nullable().optional(),
  groups: z.array(UcpFulfillmentGroupUpdateSchema).optional(),
}).passthrough()

const UcpFulfillmentUpdateSchema = z.object({
  methods: z.array(UcpFulfillmentMethodUpdateSchema).optional(),
}).passthrough()

export const UpdateUcpCheckoutSessionSchema = z.object({
  line_items: z.array(z.object({
    item: z.object({ id: z.string() }).optional(),
    line_item_id: z.string().optional(),
    quantity: z.number().int().min(0),
  })).optional(),
  buyer: UcpBuyerSchema.optional(),
  shipping_address: UcpAddressSchema.optional(),
  fulfillment: UcpFulfillmentUpdateSchema.optional(),
  discounts: z.object({
    codes: z.array(z.string()).optional(),
  }).optional(),
  context: z.object({
    currency: z.string().optional(),
    region_id: z.string().optional(),
  }).optional(),
})

export const CompleteUcpCheckoutSessionSchema = z.object({
  payment: z.object({
    instruments: z.array(z.object({
      id: z.string().optional(),
      handler_id: z.string().optional(),
      type: z.string().optional(),
      credential: z.record(z.string(), z.unknown()).optional(),
    })).optional(),
    handlers: z.array(z.any()).optional(),
  }).optional(),
  buyer: UcpBuyerSchema.optional(),
})

// UCP catalog context — buyer signals for localization/pricing (spec
// types/context.json). `passthrough` keeps forward-compat with signals the spec
// may add; the extra region_id/country_code are direct Medusa hints we accept.
const UcpCatalogContextSchema = z.object({
  address_country: z.string().optional(),
  address_region: z.string().optional(),
  postal_code: z.string().optional(),
  currency: z.string().optional(),
  language: z.string().optional(),
  intent: z.string().optional(),
  region_id: z.string().optional(),
  country_code: z.string().min(2).optional(),
}).passthrough().optional()

export const CatalogSearchSchema = z.object({
  query: z.string().optional(),
  filters: z.object({
    // Spec: categories (array of category `value`s, OR logic) + price (minor units).
    categories: z.array(z.string()).optional(),
    price: z.object({
      min: z.number().int().min(0).optional(),
      max: z.number().int().min(0).optional(),
    }).optional(),
    // Legacy / direct hints (back-compat).
    category: z.string().optional(),
    collection: z.string().optional(),
    min_price: z.number().optional(),
    max_price: z.number().optional(),
  }).passthrough().optional(),
  context: UcpCatalogContextSchema,
  pagination: z.object({
    limit: z.number().int().positive().max(100).optional().default(20),
    offset: z.number().int().min(0).optional().default(0),
    cursor: z.string().optional(),
  }).optional(),
})

export const CatalogLookupSchema = z.object({
  ids: z.array(z.string()).min(1),
  context: UcpCatalogContextSchema,
})
